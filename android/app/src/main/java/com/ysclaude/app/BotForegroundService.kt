package com.ysclaude.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BotForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "YSClaude:BotChannels")
      .apply {
        setReferenceCounted(false)
        acquire()
      }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channels = intent?.getStringExtra(EXTRA_CHANNELS).orEmpty().ifBlank { "QQ / 微信" }
    startForeground(NOTIFICATION_ID, buildNotification(channels))
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun buildNotification(channels: String): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("YSClaude Bot 正在运行")
      .setContentText("$channels 消息接收与 AI 回复保持在线")
      .setContentIntent(pendingIntent)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Bot 后台服务",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "保持 QQ Bot 和微信 ClawBot 在后台接收消息并触发 AI"
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL_ID = "ysclaude-bot-channels"
    private const val NOTIFICATION_ID = 8403
    private const val EXTRA_CHANNELS = "channels"

    fun start(context: Context, channels: String) {
      val intent = Intent(context, BotForegroundService::class.java)
        .putExtra(EXTRA_CHANNELS, channels)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, BotForegroundService::class.java))
    }
  }
}

class BotForegroundServiceModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "BotForegroundService"

  @ReactMethod
  fun start(channels: String, promise: Promise) {
    try {
      BotForegroundService.start(reactApplicationContext, channels)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BOT_FOREGROUND_SERVICE_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      BotForegroundService.stop(reactApplicationContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BOT_FOREGROUND_SERVICE_STOP_FAILED", error.message, error)
    }
  }
}
