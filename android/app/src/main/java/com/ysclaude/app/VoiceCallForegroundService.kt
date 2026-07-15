package com.ysclaude.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class VoiceCallForegroundService : Service() {
  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val mode = intent?.getStringExtra(EXTRA_MODE).orEmpty()
    val notification = buildNotification(mode)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      var foregroundTypes = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      if (mode == MODE_VIDEO) {
        foregroundTypes = foregroundTypes or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      }
      startForeground(NOTIFICATION_ID, notification, foregroundTypes)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // A WebRTC call cannot survive the app process being killed. Do not revive a
    // stale notification without a corresponding room/session.
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun buildNotification(mode: String): Notification {
    val openCallIntent = Intent(this, MainActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      data = android.net.Uri.parse("ysclaude://voice-call")
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      openCallIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val callType = when (mode) {
      MODE_VIDEO -> "视频通话"
      MODE_SCREEN -> "共享屏幕通话"
      else -> "语音通话"
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("YSClaude $callType")
      .setContentText("通话进行中，点按返回通话")
      .setContentIntent(pendingIntent)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "通话服务",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "保持语音、视频和共享屏幕通话在后台运行"
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL_ID = "ysclaude-voice-call"
    private const val NOTIFICATION_ID = 8402
    private const val EXTRA_MODE = "mode"
    private const val MODE_VIDEO = "video"
    private const val MODE_SCREEN = "screen"

    fun start(context: Context, mode: String) {
      val intent = Intent(context, VoiceCallForegroundService::class.java)
        .putExtra(EXTRA_MODE, mode)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, VoiceCallForegroundService::class.java))
    }
  }
}

class VoiceCallServiceModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "VoiceCallService"

  @ReactMethod
  fun start(mode: String, promise: Promise) {
    try {
      VoiceCallForegroundService.start(reactApplicationContext, mode)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("VOICE_CALL_SERVICE_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      VoiceCallForegroundService.stop(reactApplicationContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("VOICE_CALL_SERVICE_STOP_FAILED", error.message, error)
    }
  }
}
