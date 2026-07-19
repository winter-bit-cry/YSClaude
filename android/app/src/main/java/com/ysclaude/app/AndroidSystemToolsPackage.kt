package com.ysclaude.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AndroidSystemToolsPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(
      AndroidSystemToolsModule(reactContext),
      IncomingCallRingtoneModule(reactContext),
      RemoteSshCommandModule(reactContext),
      AndroidFilePickerModule(reactContext),
      FloatingBallModule(reactContext),
      VoiceCallServiceModule(reactContext),
      BotForegroundServiceModule(reactContext),
      TodayTodoWidgetModule(reactContext),
      ShizukuShellModule(reactContext)
    )
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
