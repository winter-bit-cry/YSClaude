package com.ysclaude.app

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.ClipData
import android.content.ClipboardManager
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.provider.ContactsContract
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap

class AndroidSystemToolsModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "AndroidSystemTools"

  @ReactMethod
  fun openNotificationAccessSettings(promise: Promise) {
    try {
      reactContext.startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("OPEN_NOTIFICATION_ACCESS_FAILED", error) }
  }

  @ReactMethod
  fun getNotifications(appQuery: String?, limit: Double, promise: Promise) {
    try {
      val query = appQuery.orEmpty().trim().lowercase()
      val pm = reactContext.packageManager
      val rows = YSClaudeNotificationListenerService.notifications()
        .sortedByDescending { it.postTime }
        .filter {
          if (query.isBlank()) true else {
            val label = getAppLabel(pm, it.packageName).lowercase()
            it.packageName.lowercase().contains(query) || label.contains(query)
          }
        }.take(limit.toInt().coerceIn(1, 200))
      val result = WritableNativeMap()
      result.putBoolean("permissionGranted", YSClaudeNotificationListenerService.instance != null)
      val items = WritableNativeArray()
      rows.forEach {
        val extras = it.notification.extras
        val item = WritableNativeMap()
        item.putString("packageName", it.packageName)
        item.putString("appName", getAppLabel(pm, it.packageName))
        item.putString("title", extras.getCharSequence("android.title")?.toString().orEmpty())
        item.putString("text", extras.getCharSequence("android.text")?.toString().orEmpty())
        item.putString("subText", extras.getCharSequence("android.subText")?.toString().orEmpty())
        item.putDouble("postedAt", it.postTime.toDouble())
        item.putBoolean("ongoing", it.isOngoing)
        items.pushMap(item)
      }
      result.putArray("notifications", items)
      if (YSClaudeNotificationListenerService.instance == null) result.putString("message", "请先授予 YSClaude 通知使用权")
      promise.resolve(result)
    } catch (error: Exception) { promise.reject("GET_NOTIFICATIONS_FAILED", error) }
  }

  @ReactMethod
  fun getClipboard(promise: Promise) {
    try {
      val manager = reactContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      val clip = manager.primaryClip
      val result = WritableNativeMap()
      result.putString("label", clip?.description?.label?.toString().orEmpty())
      val content = if (clip != null && clip.itemCount > 0) {
        clip.getItemAt(0).coerceToText(reactContext).toString()
      } else ""
      result.putString("content", content)
      promise.resolve(result)
    } catch (error: Exception) { promise.reject("GET_CLIPBOARD_FAILED", error) }
  }

  @ReactMethod
  fun editContact(name: String?, phone: String?, email: String?, promise: Promise) {
    try {
      val intent = Intent(Intent.ACTION_INSERT, ContactsContract.Contacts.CONTENT_URI).apply {
        putExtra(ContactsContract.Intents.Insert.NAME, name.orEmpty())
        putExtra(ContactsContract.Intents.Insert.PHONE, phone.orEmpty())
        putExtra(ContactsContract.Intents.Insert.EMAIL, email.orEmpty())
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent); promise.resolve(true)
    } catch (error: Exception) { promise.reject("EDIT_CONTACT_FAILED", error) }
  }

  @ReactMethod
  fun findContacts(name: String, limit: Double, promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
        reactContext.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("CONTACTS_PERMISSION_DENIED", "未获得通讯录读取权限")
        return
      }
      val result = WritableNativeMap()
      val contacts = WritableNativeArray()
      val maxResults = limit.toInt().coerceIn(1, 50)
      val projection = arrayOf(
        ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
        ContactsContract.CommonDataKinds.Phone.NUMBER,
        ContactsContract.CommonDataKinds.Phone.TYPE,
        ContactsContract.CommonDataKinds.Phone.LABEL
      )
      val selection = "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY} LIKE ?"
      val seen = mutableSetOf<String>()
      reactContext.contentResolver.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        projection,
        selection,
        arrayOf("%${name.trim()}%"),
        "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY} COLLATE LOCALIZED ASC"
      )?.use { cursor ->
        val idIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
        val nameIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY)
        val numberIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
        val typeIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.TYPE)
        val labelIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.LABEL)
        while (cursor.moveToNext() && contacts.size() < maxResults) {
          val number = cursor.getString(numberIndex).orEmpty()
          val key = "${cursor.getLong(idIndex)}:$number"
          if (!seen.add(key)) continue
          val item = WritableNativeMap()
          item.putString("id", cursor.getLong(idIndex).toString())
          item.putString("name", cursor.getString(nameIndex).orEmpty())
          item.putString("phone", number)
          item.putString("label", ContactsContract.CommonDataKinds.Phone.getTypeLabel(
            reactContext.resources,
            cursor.getInt(typeIndex),
            cursor.getString(labelIndex)
          ).toString())
          contacts.pushMap(item)
        }
      }
      result.putString("query", name.trim())
      result.putArray("contacts", contacts)
      result.putInt("count", contacts.size())
      promise.resolve(result)
    } catch (error: Exception) { promise.reject("FIND_CONTACTS_FAILED", error) }
  }

  @ReactMethod
  fun composeSms(phone: String, message: String?, promise: Promise) {
    try {
      val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${Uri.encode(phone)}")).apply {
        putExtra("sms_body", message.orEmpty()); addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent); promise.resolve(true)
    } catch (error: Exception) { promise.reject("COMPOSE_SMS_FAILED", error) }
  }

  @ReactMethod
  fun dialPhone(phone: String, promise: Promise) {
    try {
      reactContext.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(phone)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("DIAL_PHONE_FAILED", error) }
  }

  private fun hasUsageAccess(): Boolean {
    val appOps = reactContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        android.os.Process.myUid(),
        reactContext.packageName
      )
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        android.os.Process.myUid(),
        reactContext.packageName
      )
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  @ReactMethod
  fun openUsageAccessSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("OPEN_USAGE_SETTINGS_FAILED", error)
    }
  }

  @ReactMethod
  fun getAppUsageStats(startTime: Double, endTime: Double, limit: Double, promise: Promise) {
    try {
      val result = WritableNativeMap()
      val permissionGranted = hasUsageAccess()
      result.putBoolean("permissionGranted", permissionGranted)
      result.putString("permissionAction", Settings.ACTION_USAGE_ACCESS_SETTINGS)
      if (!permissionGranted) {
        result.putString("message", "需要在系统设置中为 YSClaude 授予“使用情况访问权限”后才能读取应用使用时间。")
        result.putArray("apps", WritableNativeArray())
        promise.resolve(result)
        return
      }

      val usageStatsManager = reactContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val stats = usageStatsManager
        .queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startTime.toLong(), endTime.toLong())
        .orEmpty()
        .filter { it.totalTimeInForeground > 0 }
        .groupBy { it.packageName }
        .map { (packageName, rows) ->
          val total = rows.sumOf { it.totalTimeInForeground }
          val lastUsed = rows.maxOf { it.lastTimeUsed }
          Triple(packageName, total, lastUsed)
        }
        .sortedByDescending { it.second }
        .take(limit.toInt().coerceIn(1, 100))

      val apps = WritableNativeArray()
      val packageManager = reactContext.packageManager
      stats.forEach { (packageName, totalForegroundMs, lastTimeUsed) ->
        val app = WritableNativeMap()
        app.putString("packageName", packageName)
        app.putString("appName", getAppLabel(packageManager, packageName))
        app.putDouble("totalTimeInForegroundMs", totalForegroundMs.toDouble())
        app.putDouble("totalTimeInForegroundMinutes", totalForegroundMs / 60000.0)
        app.putDouble("lastTimeUsed", lastTimeUsed.toDouble())
        apps.pushMap(app)
      }

      result.putArray("apps", apps)
      result.putDouble("startTime", startTime)
      result.putDouble("endTime", endTime)
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("GET_APP_USAGE_STATS_FAILED", error)
    }
  }

  private fun getAppLabel(packageManager: PackageManager, packageName: String): String {
    return try {
      val info = packageManager.getApplicationInfo(packageName, 0)
      packageManager.getApplicationLabel(info).toString()
    } catch (_: Exception) {
      packageName
    }
  }
}
