package com.ysclaude.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaPlayer
import android.media.MediaRecorder
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
    private const val PLAYBACK_START_GUARD_MS = 350L
    private const val BARGE_IN_PREROLL_MS = 320
    private const val BARGE_IN_MIN_SPEECH_MS = 140
    private const val BARGE_IN_COOLDOWN_MS = 1_500L
    private const val BARGE_IN_RECOGNITION_OPEN_MS = 2_500L
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
  private var echoCanceler: AcousticEchoCanceler? = null
  private var noiseSuppressor: NoiseSuppressor? = null
  private var gainControl: AutomaticGainControl? = null
  private var previousAudioMode: Int? = null
  private var previousSpeakerphone: Boolean? = null
  private val bargeInPreroll = ArrayDeque<ByteArray>()
  private val bargeInLock = Any()
  private var playbackGateStartedAtMs = 0L
  private var playbackEchoRms = 900.0
  private var bargeInSpeechMs = 0
  private var bargeInLastEventAtMs = 0L

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
            sendEvent(
              "VoiceCallAudioChunk",
              Arguments.createMap().apply {
                putString("base64", Base64.encodeToString(payload, Base64.NO_WRAP))
                putInt("sampleRate", normalizedSampleRate)
              }
            )
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
    cleanupMic()
    cleanupSpeaker()
    restoreAudioModeIfIdle(force = true)
    promise.resolve(true)
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
    micSuppressedUntilMs.set(System.currentTimeMillis() + 1_000)
  }

  private fun suppressMicAfterPlayback() {
    micSuppressedUntilMs.set(System.currentTimeMillis() + 900)
  }

  private fun endPlaybackGate() {
    val now = System.currentTimeMillis()
    val recentlyBargedIn = now - bargeInLastEventAtMs < BARGE_IN_RECOGNITION_OPEN_MS
    playbackGateStartedAtMs = 0L
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
    val threshold = maxOf(1_800.0, playbackEchoRms * 2.15)
    val loudNearSpeech = rms >= threshold && peak >= 4_500
    if (loudNearSpeech) {
      bargeInSpeechMs += chunkMs
    } else {
      updatePlaybackEchoFloor(rms, fast = false)
      bargeInSpeechMs = maxOf(0, bargeInSpeechMs - chunkMs * 2)
    }

    return bargeInSpeechMs >= BARGE_IN_MIN_SPEECH_MS && now - bargeInLastEventAtMs >= BARGE_IN_COOLDOWN_MS
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
    clearClipQueue()
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

  private fun isBenignDecoderCancellation(error: Exception): Boolean {
    val message = (error.message ?: "").lowercase()
    return message.contains("dequeue output buffer request cancelled") ||
      message.contains("pending dequeue output buffer request cancelled") ||
      message.contains("request cancelled")
  }

  private fun configureCommunicationMode() {
    val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (previousAudioMode == null) previousAudioMode = audioManager.mode
    if (previousSpeakerphone == null) previousSpeakerphone = audioManager.isSpeakerphoneOn
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    audioManager.isSpeakerphoneOn = true
  }

  private fun restoreAudioModeIfIdle(force: Boolean = false) {
    if (!force && (micRunning.get() || speakerRunning.get())) return
    val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    previousAudioMode?.let { audioManager.mode = it }
    previousSpeakerphone?.let { audioManager.isSpeakerphoneOn = it }
    previousAudioMode = null
    previousSpeakerphone = null
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

  private fun sendEvent(name: String, params: Any) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, params)
  }
}
