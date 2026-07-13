package com.ysclaude.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.media.RingtoneManager
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.nio.ByteBuffer
import java.io.File
import java.io.FileOutputStream
import java.util.ArrayDeque
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread
import kotlin.math.min
import kotlin.math.sqrt

class VoiceCallAudioModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    private const val PLAYBACK_START_GUARD_MS = 120L
    private const val BARGE_IN_PREROLL_MS = 320
    private const val BARGE_IN_MIN_SPEECH_MS = 20
    private const val BARGE_IN_COOLDOWN_MS = 700L
    private const val BARGE_IN_RECOGNITION_OPEN_MS = 2_500L
    private const val MIC_PREROLL_MS = 720
    private const val MIC_START_MIN_SPEECH_MS = 40
    private const val MIC_TRAILING_AUDIO_MS = 1_260
    private const val MIC_END_SILENCE_MS = 1_320
    private const val MIC_INITIAL_NOISE_RMS = 260.0
    private const val MIC_MIN_START_RMS = 280.0
    private const val MIC_MIN_ACTIVE_RMS = 200.0
  }

  override fun getName(): String = "VoiceCallAudio"

  private val micRunning = AtomicBoolean(false)
  private val speakerRunning = AtomicBoolean(false)
  private val micSuppressedUntilMs = AtomicLong(0)
  private val bargeInTriggered = AtomicBoolean(false)
  private val mp3Queue = LinkedBlockingQueue<ByteArray>()

  private var micThread: Thread? = null
  private var decoderThread: Thread? = null
  private var audioRecord: AudioRecord? = null
  private var audioTrack: AudioTrack? = null
  private var decoder: MediaCodec? = null
  private val clipQueue = ArrayDeque<File>()
  private val clipLock = Any()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var currentClipPlayer: MediaPlayer? = null
  private var currentClipFile: File? = null
  private var incomingRingtonePlayer: MediaPlayer? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var noiseSuppressor: NoiseSuppressor? = null
  private var gainControl: AutomaticGainControl? = null
  private var previousAudioMode: Int? = null
  private var previousSpeakerphone: Boolean? = null
  private var previousCommunicationDevice: AudioDeviceInfo? = null
  private var previousCommunicationDeviceCaptured = false
  private val bargeInPreroll = ArrayDeque<ByteArray>()
  private val micPreroll = ArrayDeque<ByteArray>()
  private val bargeInLock = Any()
  private var playbackGateStartedAtMs = 0L
  private var pcmPlaybackActive = false
  private var playbackEchoRms = 900.0
  private var bargeInSpeechMs = 0
  private var bargeInLastEventAtMs = 0L
  private var micSpeechActive = false
  private var micSpeechMs = 0
  private var micSilenceMs = 0
  private var micNoiseRms = MIC_INITIAL_NOISE_RMS
  private var speakerVolume = 1.0f
  private var bargeInMinSpeechMs = BARGE_IN_MIN_SPEECH_MS
  private var bargeInRmsFloor = 180.0
  private var bargeInEchoMultiplier = 0.38
  private var bargeInPeakThreshold = 380
  private var bargeInClearPeakThreshold = 1_600
  private var bargeInClearRmsThreshold = 160.0
  private var playbackMicSuppressMs = 1_000L
  private var afterPlaybackSuppressMs = 900L
  private var micStartMinSpeechMs = MIC_START_MIN_SPEECH_MS
  private var micEndSilenceMs = MIC_END_SILENCE_MS
  private var micTrailingAudioMs = MIC_TRAILING_AUDIO_MS
  private var micMinStartRms = MIC_MIN_START_RMS
  private var micMinActiveRms = MIC_MIN_ACTIVE_RMS

  @ReactMethod
  fun startMic(sampleRate: Double, chunkMs: Double, promise: Promise) {
    if (micRunning.get()) {
      promise.resolve(true)
      return
    }
    if (reactContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("VOICE_CALL_AUDIO_PERMISSION", "Microphone permission is required")
      return
    }

    val normalizedSampleRate = sampleRate.toInt().coerceIn(8000, 48000)
    val normalizedChunkMs = chunkMs.toInt().coerceIn(10, 100)
    val bytesPerSample = 2
    val chunkBytes = (normalizedSampleRate * normalizedChunkMs / 1000) * bytesPerSample
    val minBuffer = AudioRecord.getMinBufferSize(
      normalizedSampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    )
    if (minBuffer <= 0) {
      promise.reject("VOICE_CALL_AUDIO_INIT", "Unable to create microphone buffer")
      return
    }

    try {
      configureCommunicationMode()
      val record = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        AudioRecord.Builder()
          .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
          .setAudioFormat(
            AudioFormat.Builder()
              .setSampleRate(normalizedSampleRate)
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
              .build()
          )
          .setBufferSizeInBytes(maxOf(minBuffer * 2, chunkBytes * 4))
          .build()
      } else {
        @Suppress("DEPRECATION")
        AudioRecord(
          MediaRecorder.AudioSource.VOICE_COMMUNICATION,
          normalizedSampleRate,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT,
          maxOf(minBuffer * 2, chunkBytes * 4)
        )
      }

      if (record.state != AudioRecord.STATE_INITIALIZED) {
        record.release()
        promise.reject("VOICE_CALL_AUDIO_INIT", "Microphone is not initialized")
        return
      }

      audioRecord = record
      attachVoiceEffects(record.audioSessionId)
      resetMicGate()
      micRunning.set(true)
      record.startRecording()
      micThread = thread(name = "VoiceCallMic") {
        val buffer = ByteArray(chunkBytes)
        while (micRunning.get()) {
          val read = record.read(buffer, 0, buffer.size)
          if (read > 0) {
            val payload = if (read == buffer.size) buffer else buffer.copyOf(read)
            if (shouldSuppressMic()) {
              rememberBargeInPreroll(payload, normalizedChunkMs)
              if (isLikelyBargeIn(payload, normalizedChunkMs)) {
                emitBargeIn(normalizedSampleRate)
              }
              continue
            }
            processListeningMicChunk(payload, normalizedChunkMs, normalizedSampleRate)
          }
        }
      }
      promise.resolve(true)
    } catch (error: Exception) {
      cleanupMic()
      restoreAudioModeIfIdle()
      promise.reject("VOICE_CALL_AUDIO_START_MIC", error)
    }
  }

  @ReactMethod
  fun stopMic(promise: Promise) {
    cleanupMic()
    restoreAudioModeIfIdle()
    promise.resolve(true)
  }

  @ReactMethod
  fun startMp3Speaker(sampleRate: Double, channels: Double, promise: Promise) {
    if (speakerRunning.get()) {
      promise.resolve(true)
      return
    }
    val normalizedSampleRate = sampleRate.toInt().coerceIn(8000, 48000)
    val normalizedChannels = channels.toInt().coerceIn(1, 2)
    val channelMask = if (normalizedChannels == 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
    val minBuffer = AudioTrack.getMinBufferSize(
      normalizedSampleRate,
      channelMask,
      AudioFormat.ENCODING_PCM_16BIT
    )
    if (minBuffer <= 0) {
      promise.reject("VOICE_CALL_AUDIO_SPEAKER_INIT", "Unable to create speaker buffer")
      return
    }

    try {
      configureCommunicationMode()
      mp3Queue.clear()
      val track = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        AudioTrack.Builder()
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          .setAudioFormat(
            AudioFormat.Builder()
              .setSampleRate(normalizedSampleRate)
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setChannelMask(channelMask)
              .build()
          )
          .setBufferSizeInBytes(maxOf(minBuffer * 4, normalizedSampleRate))
          .setTransferMode(AudioTrack.MODE_STREAM)
          .build()
      } else {
        @Suppress("DEPRECATION")
        AudioTrack(
          AudioManager.STREAM_VOICE_CALL,
          normalizedSampleRate,
          channelMask,
          AudioFormat.ENCODING_PCM_16BIT,
          maxOf(minBuffer * 4, normalizedSampleRate),
          AudioTrack.MODE_STREAM
        )
      }

      if (track.state != AudioTrack.STATE_INITIALIZED) {
        track.release()
        promise.reject("VOICE_CALL_AUDIO_SPEAKER_INIT", "Speaker is not initialized")
        return
      }

      val codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_MPEG)
      val format = MediaFormat.createAudioFormat(
        MediaFormat.MIMETYPE_AUDIO_MPEG,
        normalizedSampleRate,
        normalizedChannels
      )
      codec.configure(format, null, null, 0)
      codec.start()

      audioTrack = track
      decoder = codec
      applySpeakerVolume(track)
      speakerRunning.set(true)
      track.play()
      decoderThread = thread(name = "VoiceCallMp3Decoder") {
        decodeMp3Loop(codec, track)
      }
      promise.resolve(true)
    } catch (error: Exception) {
      cleanupSpeaker()
      restoreAudioModeIfIdle()
      promise.reject("VOICE_CALL_AUDIO_START_SPEAKER", error)
    }
  }

  @ReactMethod
  fun setSpeakerphoneOn(enabled: Boolean, promise: Promise) {
    try {
      val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      rememberAudioRouteState(audioManager)
      audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
      setCommunicationSpeakerphone(audioManager, enabled)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("VOICE_CALL_AUDIO_ROUTE", error)
    }
  }

  @ReactMethod
  fun setSpeakerVolume(volume: Double, promise: Promise) {
    try {
      speakerVolume = volume.toFloat().coerceIn(0.0f, 1.0f)
      audioTrack?.let { applySpeakerVolume(it) }
      synchronized(clipLock) {
        currentClipPlayer?.setVolume(speakerVolume, speakerVolume)
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("VOICE_CALL_AUDIO_VOLUME", error)
    }
  }

  @ReactMethod
  fun setTuningConfig(config: ReadableMap, promise: Promise) {
    try {
      bargeInMinSpeechMs = readDouble(config, "bargeInMinSpeechMs", bargeInMinSpeechMs.toDouble()).toInt().coerceIn(10, 500)
      bargeInRmsFloor = readDouble(config, "bargeInRmsFloor", bargeInRmsFloor).coerceIn(50.0, 3_000.0)
      bargeInEchoMultiplier = readDouble(config, "bargeInEchoMultiplier", bargeInEchoMultiplier).coerceIn(0.05, 3.0)
      bargeInPeakThreshold = readDouble(config, "bargeInPeakThreshold", bargeInPeakThreshold.toDouble()).toInt().coerceIn(100, 8_000)
      bargeInClearPeakThreshold = readDouble(config, "bargeInClearPeakThreshold", bargeInClearPeakThreshold.toDouble()).toInt().coerceIn(200, 12_000)
      bargeInClearRmsThreshold = readDouble(config, "bargeInClearRmsThreshold", bargeInClearRmsThreshold).coerceIn(50.0, 3_000.0)
      playbackMicSuppressMs = readDouble(config, "playbackMicSuppressMs", playbackMicSuppressMs.toDouble()).toLong().coerceIn(0L, 3_000L)
      afterPlaybackSuppressMs = readDouble(config, "afterPlaybackSuppressMs", afterPlaybackSuppressMs.toDouble()).toLong().coerceIn(0L, 3_000L)
      micStartMinSpeechMs = readDouble(config, "micStartMinSpeechMs", micStartMinSpeechMs.toDouble()).toInt().coerceIn(10, 500)
      micEndSilenceMs = readDouble(config, "micEndSilenceMs", micEndSilenceMs.toDouble()).toInt().coerceIn(200, 4_000)
      micTrailingAudioMs = readDouble(config, "micTrailingAudioMs", micTrailingAudioMs.toDouble()).toInt().coerceIn(100, 4_000)
      micMinStartRms = readDouble(config, "micMinStartRms", micMinStartRms).coerceIn(50.0, 3_000.0)
      micMinActiveRms = readDouble(config, "micMinActiveRms", micMinActiveRms).coerceIn(50.0, 3_000.0)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("VOICE_CALL_AUDIO_TUNING", error)
    }
  }

  @ReactMethod
  fun writeMp3Chunk(base64: String, promise: Promise) {
    if (!speakerRunning.get()) {
      promise.resolve(false)
      return
    }
    try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      if (bytes.isNotEmpty()) {
        mp3Queue.offer(bytes)
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("VOICE_CALL_AUDIO_WRITE_MP3", error)
    }
  }

  @ReactMethod
  fun writePcmChunk(base64: String, promise: Promise) {
    if (!speakerRunning.get()) {
      promise.resolve(false)
      return
    }
    try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      if (bytes.isNotEmpty()) {
        if (!pcmPlaybackActive || playbackGateStartedAtMs == 0L) {
          beginPlaybackGate()
          pcmPlaybackActive = true
        }
        emitPlaybackState(true)
        audioTrack?.write(bytes, 0, bytes.size)
        suppressMicForPlayback()
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("VOICE_CALL_AUDIO_WRITE_PCM", error)
    }
  }

  @ReactMethod
  fun finishPcmPlayback(promise: Promise) {
    try {
      pcmPlaybackActive = false
      suppressMicAfterPlayback()
      endPlaybackGate()
      emitPlaybackState(false)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("VOICE_CALL_AUDIO_FINISH_PCM", error)
    }
  }

  @ReactMethod
  fun enqueueMp3Clip(base64: String, promise: Promise) {
    try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      if (bytes.isEmpty()) {
        promise.resolve(false)
        return
      }
      val file = File.createTempFile("voice_call_tts_", ".mp3", reactContext.cacheDir)
      FileOutputStream(file).use { it.write(bytes) }
      val wasIdle = synchronized(clipLock) {
        val idle = currentClipPlayer == null && clipQueue.isEmpty()
        clipQueue.add(file)
        idle
      }
      if (wasIdle) {
        beginPlaybackGate()
      } else {
        suppressMicForPlayback()
      }
      emitPlaybackState(true)
      mainHandler.post { startNextClipIfNeeded() }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("VOICE_CALL_AUDIO_ENQUEUE_MP3", error)
    }
  }

  @ReactMethod
  fun clearSpeaker(promise: Promise) {
    mp3Queue.clear()
    pcmPlaybackActive = false
    clearClipQueue()
    try {
      audioTrack?.pause()
      audioTrack?.flush()
      audioTrack?.play()
    } catch (_: Exception) {
    }
    promise.resolve(true)
  }

  @ReactMethod
  fun stopSpeaker(promise: Promise) {
    cleanupSpeaker()
    restoreAudioModeIfIdle()
    promise.resolve(true)
  }

  @ReactMethod
  fun stopAll(promise: Promise) {
    stopIncomingRingtoneInternal()
    cleanupMic()
    cleanupSpeaker()
    restoreAudioModeIfIdle(force = true)
    promise.resolve(true)
  }

  @ReactMethod
  fun startIncomingRingtone(promise: Promise) {
    mainHandler.post {
      try {
        stopIncomingRingtoneInternal()
        val ringtoneUri = RingtoneManager.getActualDefaultRingtoneUri(
          reactContext,
          RingtoneManager.TYPE_RINGTONE
        ) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        if (ringtoneUri == null) {
          promise.resolve(false)
          return@post
        }
        val player = MediaPlayer()
        incomingRingtonePlayer = player
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          player.setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build()
          )
        } else {
          @Suppress("DEPRECATION")
          player.setAudioStreamType(AudioManager.STREAM_RING)
        }
        player.isLooping = true
        player.setDataSource(reactContext, ringtoneUri)
        player.prepare()
        player.start()
        promise.resolve(true)
      } catch (error: Exception) {
        stopIncomingRingtoneInternal()
        promise.reject("VOICE_CALL_RINGTONE", error)
      }
    }
  }

  @ReactMethod
  fun stopIncomingRingtone(promise: Promise) {
    mainHandler.post {
      stopIncomingRingtoneInternal()
      promise.resolve(true)
    }
  }

  private fun decodeMp3Loop(codec: MediaCodec, track: AudioTrack) {
    val bufferInfo = MediaCodec.BufferInfo()
    while (speakerRunning.get()) {
      try {
        val chunk = mp3Queue.poll()
        if (chunk != null) {
          val inputIndex = codec.dequeueInputBuffer(10_000)
          if (inputIndex >= 0) {
            val inputBuffer = codec.getInputBuffer(inputIndex)
            if (inputBuffer != null) {
              inputBuffer.clear()
              val length = min(inputBuffer.capacity(), chunk.size)
              inputBuffer.put(chunk, 0, length)
              codec.queueInputBuffer(inputIndex, 0, length, System.nanoTime() / 1000, 0)
              if (length < chunk.size) {
                mp3Queue.offer(chunk.copyOfRange(length, chunk.size))
              }
            }
          }
        }

        var outputIndex = codec.dequeueOutputBuffer(bufferInfo, 10_000)
        while (outputIndex >= 0) {
          val outputBuffer: ByteBuffer? = codec.getOutputBuffer(outputIndex)
          if (outputBuffer != null && bufferInfo.size > 0) {
            val pcm = ByteArray(bufferInfo.size)
            outputBuffer.position(bufferInfo.offset)
            outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
            outputBuffer.get(pcm)
            track.write(pcm, 0, pcm.size)
          }
          codec.releaseOutputBuffer(outputIndex, false)
          outputIndex = codec.dequeueOutputBuffer(bufferInfo, 0)
        }
      } catch (error: Exception) {
        if (isBenignDecoderCancellation(error)) {
          break
        }
        if (speakerRunning.get()) {
          sendEvent(
            "VoiceCallAudioError",
            Arguments.createMap().apply {
              putString("message", error.message ?: "Speaker decoder failed")
            }
          )
        }
        break
      }
    }
  }

  private fun startNextClipIfNeeded() {
    synchronized(clipLock) {
      if (currentClipPlayer != null) return
      val file = clipQueue.pollFirst() ?: return
      currentClipFile = file
      try {
        val player = MediaPlayer()
        currentClipPlayer = player
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          player.setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
        } else {
          @Suppress("DEPRECATION")
          player.setAudioStreamType(AudioManager.STREAM_VOICE_CALL)
        }
        player.setVolume(speakerVolume, speakerVolume)
        player.setDataSource(file.absolutePath)
        player.setOnCompletionListener {
          finishCurrentClip()
          startNextClipIfNeeded()
        }
        player.setOnErrorListener { _, _, _ ->
          finishCurrentClip()
          startNextClipIfNeeded()
          true
        }
        player.prepare()
        if (playbackGateStartedAtMs == 0L) {
          beginPlaybackGate()
        } else {
          suppressMicForPlayback()
        }
        emitPlaybackState(true)
        player.start()
      } catch (error: Exception) {
        finishCurrentClip()
        sendEvent(
          "VoiceCallAudioError",
          Arguments.createMap().apply {
            putString("message", error.message ?: "MP3 clip playback failed")
          }
        )
      }
    }
  }

  private fun finishCurrentClip() {
    val player: MediaPlayer?
    val file: File?
    synchronized(clipLock) {
      player = currentClipPlayer
      file = currentClipFile
      currentClipPlayer = null
      currentClipFile = null
    }
    try {
      player?.stop()
    } catch (_: Exception) {
    }
    player?.release()
    file?.delete()
    synchronized(clipLock) {
      if (currentClipPlayer == null && clipQueue.isEmpty()) {
        endPlaybackGate()
        emitPlaybackState(false)
      } else {
        suppressMicForPlayback()
      }
    }
  }

  private fun clearClipQueue() {
    mainHandler.post {
      finishCurrentClip()
      synchronized(clipLock) {
        while (clipQueue.isNotEmpty()) {
          clipQueue.pollFirst()?.delete()
        }
      }
      endPlaybackGate()
      emitPlaybackState(false)
    }
  }

  private fun shouldSuppressMic(): Boolean {
    if (bargeInTriggered.get()) return false
    if (System.currentTimeMillis() < micSuppressedUntilMs.get()) return true
    synchronized(clipLock) {
      return currentClipPlayer != null || clipQueue.isNotEmpty()
    }
  }

  private fun beginPlaybackGate() {
    val now = System.currentTimeMillis()
    bargeInTriggered.set(false)
    playbackGateStartedAtMs = now
    playbackEchoRms = 900.0
    bargeInSpeechMs = 0
    micSuppressedUntilMs.set(now + 1_000)
    synchronized(bargeInLock) {
      bargeInPreroll.clear()
    }
  }

  private fun suppressMicForPlayback() {
    if (bargeInTriggered.get()) return
    micSuppressedUntilMs.set(System.currentTimeMillis() + playbackMicSuppressMs)
  }

  private fun suppressMicAfterPlayback() {
    micSuppressedUntilMs.set(System.currentTimeMillis() + afterPlaybackSuppressMs)
  }

  private fun endPlaybackGate() {
    val now = System.currentTimeMillis()
    val recentlyBargedIn = now - bargeInLastEventAtMs < BARGE_IN_RECOGNITION_OPEN_MS
    playbackGateStartedAtMs = 0L
    pcmPlaybackActive = false
    playbackEchoRms = 900.0
    bargeInSpeechMs = 0
    if (recentlyBargedIn) {
      bargeInTriggered.set(true)
      micSuppressedUntilMs.set(0)
    } else {
      bargeInTriggered.set(false)
      suppressMicAfterPlayback()
    }
    synchronized(bargeInLock) {
      bargeInPreroll.clear()
    }
  }

  private fun rememberBargeInPreroll(payload: ByteArray, chunkMs: Int) {
    val maxChunks = maxOf(1, BARGE_IN_PREROLL_MS / chunkMs)
    synchronized(bargeInLock) {
      bargeInPreroll.add(payload.copyOf())
      while (bargeInPreroll.size > maxChunks) {
        bargeInPreroll.pollFirst()
      }
    }
  }

  private fun isLikelyBargeIn(payload: ByteArray, chunkMs: Int): Boolean {
    if (bargeInTriggered.get()) return false
    val startedAt = playbackGateStartedAtMs
    if (startedAt == 0L) return false

    val now = System.currentTimeMillis()
    val rms = calculatePcmRms(payload)
    if (now - startedAt < PLAYBACK_START_GUARD_MS) {
      updatePlaybackEchoFloor(rms, fast = true)
      return false
    }

    val peak = calculatePcmPeak(payload)
    val threshold = maxOf(bargeInRmsFloor, playbackEchoRms * bargeInEchoMultiplier)
    val loudNearSpeech =
      (rms >= threshold && peak >= bargeInPeakThreshold) ||
        (peak >= bargeInClearPeakThreshold && rms >= bargeInClearRmsThreshold)
    if (loudNearSpeech) {
      bargeInSpeechMs += chunkMs
    } else {
      updatePlaybackEchoFloor(rms, fast = false)
      bargeInSpeechMs = maxOf(0, bargeInSpeechMs - chunkMs * 2)
    }

    return bargeInSpeechMs >= bargeInMinSpeechMs && now - bargeInLastEventAtMs >= BARGE_IN_COOLDOWN_MS
  }

  private fun updatePlaybackEchoFloor(rms: Double, fast: Boolean) {
    val capped = min(rms, maxOf(900.0, playbackEchoRms * 1.6))
    playbackEchoRms = if (fast) {
      playbackEchoRms * 0.65 + capped * 0.35
    } else {
      playbackEchoRms * 0.94 + capped * 0.06
    }
  }

  private fun emitBargeIn(sampleRate: Int) {
    if (!bargeInTriggered.compareAndSet(false, true)) return
    bargeInLastEventAtMs = System.currentTimeMillis()
    micSuppressedUntilMs.set(0)
    resetMicGate()
    val chunks = Arguments.createArray()
    synchronized(bargeInLock) {
      bargeInPreroll.forEach { chunk ->
        chunks.pushString(Base64.encodeToString(chunk, Base64.NO_WRAP))
      }
      bargeInPreroll.clear()
    }
    sendEvent(
      "VoiceCallBargeIn",
      Arguments.createMap().apply {
        putInt("sampleRate", sampleRate)
        putArray("chunks", chunks)
      }
    )
  }

  private fun processListeningMicChunk(payload: ByteArray, chunkMs: Int, sampleRate: Int) {
    rememberMicPreroll(payload, chunkMs)

    val rms = calculatePcmRms(payload)
    val peak = calculatePcmPeak(payload)
    val likelySpeech = isLikelyUserSpeech(rms, peak)

    if (likelySpeech) {
      micSpeechMs += chunkMs
      micSilenceMs = 0
      if (!micSpeechActive && micSpeechMs >= micStartMinSpeechMs) {
        micSpeechActive = true
        emitMicPreroll(sampleRate)
        return
      }
      if (micSpeechActive) {
        emitMicChunk(payload, sampleRate)
      }
      return
    }

    if (micSpeechActive) {
      micSilenceMs += chunkMs
      if (micSilenceMs <= micTrailingAudioMs) {
        emitMicChunk(payload, sampleRate)
      }
      if (micSilenceMs >= micEndSilenceMs) {
        micSpeechActive = false
        micSpeechMs = 0
        micSilenceMs = 0
        micPreroll.clear()
        emitSpeechEnd(sampleRate)
      }
      return
    }

    micSpeechMs = maxOf(0, micSpeechMs - chunkMs)
    updateMicNoiseFloor(rms)
  }

  private fun rememberMicPreroll(payload: ByteArray, chunkMs: Int) {
    val maxChunks = maxOf(1, MIC_PREROLL_MS / chunkMs)
    micPreroll.add(payload.copyOf())
    while (micPreroll.size > maxChunks) {
      micPreroll.pollFirst()
    }
  }

  private fun isLikelyUserSpeech(rms: Double, peak: Int): Boolean {
    val threshold = if (micSpeechActive) {
      maxOf(micMinActiveRms, min(720.0, micNoiseRms * 1.25 + 80.0))
    } else {
      maxOf(micMinStartRms, min(900.0, micNoiseRms * 1.45 + 100.0))
    }
    val peakThreshold = if (micSpeechActive) 650 else 850
    val sustainedSpeech = rms >= threshold && peak >= peakThreshold
    val clearSpeechPeak = peak >= 3_200 && rms >= maxOf(micMinActiveRms, micNoiseRms * 1.2)
    return sustainedSpeech || clearSpeechPeak
  }

  private fun updateMicNoiseFloor(rms: Double) {
    val capped = min(rms, maxOf(MIC_INITIAL_NOISE_RMS, micNoiseRms * 1.8))
    micNoiseRms = micNoiseRms * 0.96 + capped * 0.04
  }

  private fun emitMicPreroll(sampleRate: Int) {
    while (micPreroll.isNotEmpty()) {
      micPreroll.pollFirst()?.let { emitMicChunk(it, sampleRate) }
    }
  }

  private fun emitMicChunk(payload: ByteArray, sampleRate: Int) {
    sendEvent(
      "VoiceCallAudioChunk",
      Arguments.createMap().apply {
        putString("base64", Base64.encodeToString(payload, Base64.NO_WRAP))
        putInt("sampleRate", sampleRate)
      }
    )
  }

  private fun emitSpeechEnd(sampleRate: Int) {
    sendEvent(
      "VoiceCallSpeechEnd",
      Arguments.createMap().apply {
        putInt("sampleRate", sampleRate)
      }
    )
  }

  private fun resetMicGate() {
    micPreroll.clear()
    micSpeechActive = false
    micSpeechMs = 0
    micSilenceMs = 0
    micNoiseRms = MIC_INITIAL_NOISE_RMS
  }

  private fun calculatePcmRms(payload: ByteArray): Double {
    var index = 0
    var count = 0
    var sum = 0.0
    while (index + 1 < payload.size) {
      val sample = ((payload[index].toInt() and 0xff) or (payload[index + 1].toInt() shl 8)).toShort().toInt()
      sum += sample.toDouble() * sample.toDouble()
      count += 1
      index += 2
    }
    if (count == 0) return 0.0
    return sqrt(sum / count)
  }

  private fun calculatePcmPeak(payload: ByteArray): Int {
    var index = 0
    var peak = 0
    while (index + 1 < payload.size) {
      val sample = ((payload[index].toInt() and 0xff) or (payload[index + 1].toInt() shl 8)).toShort().toInt()
      peak = maxOf(peak, kotlin.math.abs(sample))
      index += 2
    }
    return peak
  }

  private fun emitPlaybackState(active: Boolean) {
    sendEvent(
      "VoiceCallPlayback",
      Arguments.createMap().apply {
        putBoolean("active", active)
      }
    )
  }

  private fun readDouble(config: ReadableMap, key: String, fallback: Double): Double {
    if (!config.hasKey(key) || config.isNull(key)) return fallback
    return try {
      config.getDouble(key)
    } catch (_: Exception) {
      fallback
    }
  }

  private fun applySpeakerVolume(track: AudioTrack) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      track.setVolume(speakerVolume)
    } else {
      @Suppress("DEPRECATION")
      track.setStereoVolume(speakerVolume, speakerVolume)
    }
  }

  private fun isBenignDecoderCancellation(error: Exception): Boolean {
    val message = (error.message ?: "").lowercase()
    return message.contains("dequeue output buffer request cancelled") ||
      message.contains("pending dequeue output buffer request cancelled") ||
      message.contains("request cancelled")
  }

  private fun configureCommunicationMode() {
    val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    rememberAudioRouteState(audioManager)
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
  }

  private fun restoreAudioModeIfIdle(force: Boolean = false) {
    if (!force && (micRunning.get() || speakerRunning.get())) return
    val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    previousAudioMode?.let { audioManager.mode = it }
    restoreCommunicationRoute(audioManager)
    previousAudioMode = null
    previousSpeakerphone = null
    previousCommunicationDevice = null
    previousCommunicationDeviceCaptured = false
  }

  private fun rememberAudioRouteState(audioManager: AudioManager) {
    if (previousAudioMode == null) previousAudioMode = audioManager.mode
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (!previousCommunicationDeviceCaptured) {
        previousCommunicationDevice = audioManager.communicationDevice
        previousCommunicationDeviceCaptured = true
      }
      return
    }
    if (previousSpeakerphone == null) {
      previousSpeakerphone = getLegacySpeakerphoneOn(audioManager)
    }
  }

  private fun setCommunicationSpeakerphone(audioManager: AudioManager, enabled: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (!enabled) {
        audioManager.clearCommunicationDevice()
        return
      }
      val speaker = audioManager.availableCommunicationDevices.firstOrNull {
        it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
      }
      if (speaker != null) {
        audioManager.setCommunicationDevice(speaker)
      }
      return
    }
    setLegacySpeakerphoneOn(audioManager, enabled)
  }

  private fun restoreCommunicationRoute(audioManager: AudioManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (!previousCommunicationDeviceCaptured) return
      val previousDevice = previousCommunicationDevice
      if (previousDevice == null) {
        audioManager.clearCommunicationDevice()
      } else {
        audioManager.setCommunicationDevice(previousDevice)
      }
      return
    }
    previousSpeakerphone?.let { setLegacySpeakerphoneOn(audioManager, it) }
  }

  @Suppress("DEPRECATION")
  private fun getLegacySpeakerphoneOn(audioManager: AudioManager): Boolean {
    return audioManager.isSpeakerphoneOn
  }

  @Suppress("DEPRECATION")
  private fun setLegacySpeakerphoneOn(audioManager: AudioManager, enabled: Boolean) {
    audioManager.isSpeakerphoneOn = enabled
  }

  private fun attachVoiceEffects(sessionId: Int) {
    if (AcousticEchoCanceler.isAvailable()) {
      echoCanceler = AcousticEchoCanceler.create(sessionId)?.apply { enabled = true }
    }
    if (NoiseSuppressor.isAvailable()) {
      noiseSuppressor = NoiseSuppressor.create(sessionId)?.apply { enabled = true }
    }
    if (AutomaticGainControl.isAvailable()) {
      gainControl = AutomaticGainControl.create(sessionId)?.apply { enabled = true }
    }
  }

  private fun cleanupMic() {
    micRunning.set(false)
    try {
      audioRecord?.stop()
    } catch (_: Exception) {
    }
    micThread?.join(300)
    micThread = null
    echoCanceler?.release()
    noiseSuppressor?.release()
    gainControl?.release()
    echoCanceler = null
    noiseSuppressor = null
    gainControl = null
    audioRecord?.release()
    audioRecord = null
    resetMicGate()
  }

  private fun cleanupSpeaker() {
    speakerRunning.set(false)
    mp3Queue.clear()
    clearClipQueue()
    decoderThread?.join(300)
    decoderThread = null
    try {
      decoder?.stop()
    } catch (_: Exception) {
    }
    decoder?.release()
    decoder = null
    try {
      audioTrack?.pause()
      audioTrack?.flush()
    } catch (_: Exception) {
    }
    audioTrack?.release()
    audioTrack = null
  }

  private fun stopIncomingRingtoneInternal() {
    val player = incomingRingtonePlayer
    incomingRingtonePlayer = null
    try {
      player?.stop()
    } catch (_: Exception) {
    }
    player?.release()
  }

  private fun sendEvent(name: String, params: Any) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, params)
  }
}
