package com.ysclaude.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.jstasks.HeadlessJsTaskConfig

private const val WORKFLOW_CHANNEL = "ysclaude-ai-workflows"
private const val WORKFLOW_NOTIFICATION_ID = 8410
private const val EXTRA_WORKFLOW_ID = "workflowId"

class AIWorkflowKeepAliveService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "YSClaude:AIWorkflows")
      .apply { setReferenceCounted(false); acquire() }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(WORKFLOW_NOTIFICATION_ID, notification())
    return START_STICKY
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(WORKFLOW_CHANNEL, "AI 后台工作流", NotificationManager.IMPORTANCE_LOW).apply {
      description = "保持定时 AI 工作流可以在后台运行"
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun notification(): Notification {
    val openIntent = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this, WORKFLOW_CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("YSClaude 后台工作流运行中")
      .setContentText("等待定时器触发 AI 任务")
      .setContentIntent(openIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  companion object {
    fun start(context: Context) {
      val intent = Intent(context, AIWorkflowKeepAliveService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
    }
  }
}

class AIWorkflowAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val workflowId = intent.getStringExtra(EXTRA_WORKFLOW_ID) ?: return
    AIWorkflowKeepAliveService.start(context)
    val serviceIntent = Intent(context, AIWorkflowHeadlessService::class.java).putExtra(EXTRA_WORKFLOW_ID, workflowId)
    context.startService(serviceIntent)
    HeadlessJsTaskService.acquireWakeLockNow(context)
  }
}

class AIWorkflowHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val workflowId = intent?.getStringExtra(EXTRA_WORKFLOW_ID) ?: return null
    val data = com.facebook.react.bridge.Arguments.createMap().apply {
      putString("workflowId", workflowId)
      latestForegroundPackage()?.let { putString("foregroundPackage", it) }
    }
    return HeadlessJsTaskConfig("YSClaudeWorkflowTask", data, 15 * 60 * 1000L, true)
  }

  private fun latestForegroundPackage(): String? {
    return try {
      val manager = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val end = System.currentTimeMillis()
      val events = manager.queryEvents(end - 10 * 60 * 1000L, end)
      val event = UsageEvents.Event()
      var latestTime = 0L
      var latestPackage: String? = null
      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND && event.timeStamp >= latestTime) {
          latestTime = event.timeStamp
          latestPackage = event.packageName
        }
      }
      latestPackage
    } catch (_: Exception) { null }
  }
}

class AIWorkflowModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "AIWorkflowScheduler"

  private fun pendingIntent(id: String): PendingIntent {
    val intent = Intent(reactApplicationContext, AIWorkflowAlarmReceiver::class.java).putExtra(EXTRA_WORKFLOW_ID, id)
    return PendingIntent.getBroadcast(reactApplicationContext, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  @ReactMethod
  fun setKeepAlive(enabled: Boolean, promise: Promise) {
    try {
      if (enabled) AIWorkflowKeepAliveService.start(reactApplicationContext)
      else reactApplicationContext.stopService(Intent(reactApplicationContext, AIWorkflowKeepAliveService::class.java))
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("WORKFLOW_KEEPALIVE_FAILED", error.message, error) }
  }

  @ReactMethod
  fun schedule(workflowId: String, triggerAt: Double, promise: Promise) {
    try {
      val manager = reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val at = triggerAt.toLong().coerceAtLeast(System.currentTimeMillis() + 1000)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent(workflowId))
      else manager.set(AlarmManager.RTC_WAKEUP, at, pendingIntent(workflowId))
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("WORKFLOW_SCHEDULE_FAILED", error.message, error) }
  }

  @ReactMethod
  fun cancel(workflowId: String, promise: Promise) {
    try {
      val manager = reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      manager.cancel(pendingIntent(workflowId))
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("WORKFLOW_CANCEL_FAILED", error.message, error) }
  }

  @ReactMethod
  fun triggerNow(workflowId: String, promise: Promise) {
    try {
      reactApplicationContext.sendBroadcast(Intent(reactApplicationContext, AIWorkflowAlarmReceiver::class.java).putExtra(EXTRA_WORKFLOW_ID, workflowId))
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("WORKFLOW_TRIGGER_FAILED", error.message, error) }
  }
}
