package com.ysclaude.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AndroidSystemToolsPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(
      AndroidSystemToolsModule(reactContext),
      RemoteSshCommandModule(reactContext),
      AndroidFilePickerModule(reactContext),
      ShizukuFileModule(reactContext),
      FloatingBallModule(reactContext)
    )
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
