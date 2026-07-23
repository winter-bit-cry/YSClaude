package com.ysclaude.app

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class YSClaudeNotificationListenerService : NotificationListenerService() {
  override fun onListenerConnected() {
    instance = this
  }

  override fun onListenerDisconnected() {
    if (instance === this) instance = null
  }

  companion object {
    @Volatile var instance: YSClaudeNotificationListenerService? = null

    fun notifications(): Array<StatusBarNotification> =
      try { instance?.activeNotifications ?: emptyArray() } catch (_: Exception) { emptyArray() }
  }
}
