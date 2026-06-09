package com.ysclaude.app

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AccessibilityScreenContextModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "AccessibilityScreenContext"

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactContext.startActivity(intent)
    promise.resolve(true)
  }

  @ReactMethod
  fun isAccessibilityServiceEnabled(promise: Promise) {
    promise.resolve(FloatingAccessibilityService.isRunning())
  }

  @ReactMethod
  fun openInputMethodSettings(promise: Promise) {
    val intent = Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactContext.startActivity(intent)
    promise.resolve(true)
  }

  @ReactMethod
  fun showInputMethodPicker(promise: Promise) {
    val manager = reactContext.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    manager.showInputMethodPicker()
    promise.resolve(true)
  }

  @ReactMethod
  fun switchToYSClaudeInputMethod(promise: Promise) {
    if (YSClaudeInputMethodService.isReady()) {
      promise.resolve(actionToMap(FloatingAccessibilityService.ActionResult(true, "YSClaude IME is already active", null)))
      return
    }

    val manager = reactContext.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    manager.showInputMethodPicker()
    FloatingAccessibilityService.selectYSClaudeInputMethod { result ->
      result
        .onSuccess { action -> promise.resolve(actionToMap(action)) }
        .onFailure { error ->
          promise.resolve(actionToMap(FloatingAccessibilityService.ActionResult(false, error.message ?: "Unable to switch to YSClaude IME", null)))
        }
    }
  }

  @ReactMethod
  fun isInputMethodReady(promise: Promise) {
    promise.resolve(YSClaudeInputMethodService.isReady())
  }

  @ReactMethod
  fun captureScreenContext(promise: Promise) {
    FloatingAccessibilityService.captureCurrentScreenContext { result ->
      result
        .onSuccess { context ->
          val map = Arguments.createMap()
          map.putString("imageUri", context.imageUri)
          map.putString("nodeTree", context.nodeTree)
          promise.resolve(map)
        }
        .onFailure { error -> promise.reject("CAPTURE_SCREEN_CONTEXT_FAILED", error) }
    }
  }

  @ReactMethod
  fun tap(x: Double, y: Double, promise: Promise) {
    FloatingAccessibilityService.tap(x.toFloat(), y.toFloat()) { result ->
      result
        .onSuccess { action -> promise.resolve(actionToMap(action)) }
        .onFailure { error -> promise.reject("ACCESSIBILITY_TAP_FAILED", error) }
    }
  }

  @ReactMethod
  fun tapRelative(xRatio: Double, yRatio: Double, promise: Promise) {
    FloatingAccessibilityService.tapRelative(xRatio.toFloat(), yRatio.toFloat()) { result ->
      result
        .onSuccess { action -> promise.resolve(actionToMap(action)) }
        .onFailure { error -> promise.reject("ACCESSIBILITY_TAP_RELATIVE_FAILED", error) }
    }
  }

  @ReactMethod
  fun swipe(startX: Double, startY: Double, endX: Double, endY: Double, durationMs: Double, promise: Promise) {
    FloatingAccessibilityService.swipe(
      startX.toFloat(),
      startY.toFloat(),
      endX.toFloat(),
      endY.toFloat(),
      durationMs.toLong()
    ) { result ->
      result
        .onSuccess { action -> promise.resolve(actionToMap(action)) }
        .onFailure { error -> promise.reject("ACCESSIBILITY_SWIPE_FAILED", error) }
    }
  }

  @ReactMethod
  fun clickNode(nodeId: String, promise: Promise) {
    FloatingAccessibilityService.clickNode(nodeId) { result ->
      result
        .onSuccess { action -> promise.resolve(actionToMap(action)) }
        .onFailure { error -> promise.reject("ACCESSIBILITY_CLICK_NODE_FAILED", error) }
    }
  }

  @ReactMethod
  fun scrollNode(nodeId: String, direction: String, promise: Promise) {
    FloatingAccessibilityService.scrollNode(nodeId, direction) { result ->
      result
        .onSuccess { action -> promise.resolve(actionToMap(action)) }
        .onFailure { error -> promise.reject("ACCESSIBILITY_SCROLL_NODE_FAILED", error) }
    }
  }

  @ReactMethod
  fun setNodeText(nodeId: String, text: String, promise: Promise) {
    FloatingAccessibilityService.setNodeText(nodeId, text) { result ->
      result
        .onSuccess { action -> promise.resolve(actionToMap(action)) }
        .onFailure { error -> promise.reject("ACCESSIBILITY_SET_NODE_TEXT_FAILED", error) }
    }
  }

  @ReactMethod
  fun setFocusedText(text: String, promise: Promise) {
    FloatingAccessibilityService.setFocusedText(text) { result ->
      result
        .onSuccess { action -> promise.resolve(actionToMap(action)) }
        .onFailure { error -> promise.reject("ACCESSIBILITY_SET_FOCUSED_TEXT_FAILED", error) }
    }
  }

  @ReactMethod
  fun commitInputMethodText(text: String, promise: Promise) {
    val (success, message) = YSClaudeInputMethodService.commitText(text)
    promise.resolve(actionToMap(FloatingAccessibilityService.ActionResult(success, message, null)))
  }

  @ReactMethod
  fun performInputMethodAction(action: String, promise: Promise) {
    val (success, message) = YSClaudeInputMethodService.performEditorAction(action)
    promise.resolve(actionToMap(FloatingAccessibilityService.ActionResult(success, message, null)))
  }

  @ReactMethod
  fun deleteInputMethodText(beforeLength: Double, afterLength: Double, promise: Promise) {
    val (success, message) = YSClaudeInputMethodService.deleteSurroundingText(
      beforeLength.toInt(),
      afterLength.toInt()
    )
    promise.resolve(actionToMap(FloatingAccessibilityService.ActionResult(success, message, null)))
  }

  @ReactMethod
  fun performGlobalAction(action: String, promise: Promise) {
    FloatingAccessibilityService.globalAction(action) { result ->
      result
        .onSuccess { actionResult -> promise.resolve(actionToMap(actionResult)) }
        .onFailure { error -> promise.reject("ACCESSIBILITY_GLOBAL_ACTION_FAILED", error) }
    }
  }

  private fun actionToMap(action: FloatingAccessibilityService.ActionResult) =
    Arguments.createMap().apply {
      putBoolean("success", action.success)
      putString("message", action.message)
      putString("nodeTree", action.nodeTree)
    }
}
