package com.ysclaude.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executor

class FloatingAccessibilityService : AccessibilityService() {
  private val mainHandler = Handler(Looper.getMainLooper())

  data class ScreenContext(
    val imageUri: String?,
    val nodeTree: String
  )

  data class ActionResult(
    val success: Boolean,
    val message: String,
    val nodeTree: String? = null
  )

  override fun onServiceConnected() {
    instance = this
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  override fun onDestroy() {
    if (instance === this) {
      instance = null
    }
    super.onDestroy()
  }

  private fun collectNodeTree(): String {
    val root = rootInActiveWindow
    val payload = JSONObject()
    payload.put("capturedAt", System.currentTimeMillis())
    payload.put("activePackage", root?.packageName?.toString() ?: "")
    payload.put("display", JSONObject()
      .put("width", resources.displayMetrics.widthPixels)
      .put("height", resources.displayMetrics.heightPixels)
      .put("density", resources.displayMetrics.density)
      .put("densityDpi", resources.displayMetrics.densityDpi))
    payload.put("windows", JSONArray().also { windowsArray ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        windows.forEachIndexed { index, window ->
          val windowObject = JSONObject()
          windowObject.put("index", index)
          windowObject.put("type", window.type)
          windowObject.put("layer", window.layer)
          windowObject.put("focused", window.isFocused)
          window.root?.let { node ->
            windowObject.put("root", serializeNode(node, "w$index", 0, NodeBudget()))
          }
          windowsArray.put(windowObject)
        }
      } else if (root != null) {
        windowsArray.put(JSONObject().put("index", 0).put("root", serializeNode(root, "root", 0, NodeBudget())))
      }
    })
    return payload.toString()
  }

  private fun serializeNode(
    node: AccessibilityNodeInfo,
    path: String,
    depth: Int,
    budget: NodeBudget
  ): JSONObject {
    budget.count += 1
    val bounds = Rect()
    node.getBoundsInScreen(bounds)

    val objectValue = JSONObject()
    objectValue.put("id", path)
    objectValue.put("className", node.className?.toString() ?: "")
    objectValue.put("packageName", node.packageName?.toString() ?: "")
    objectValue.put("text", node.text?.toString() ?: "")
    objectValue.put("contentDescription", node.contentDescription?.toString() ?: "")
    objectValue.put("viewIdResourceName", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) node.viewIdResourceName ?: "" else "")
    objectValue.put("bounds", JSONObject()
      .put("left", bounds.left)
      .put("top", bounds.top)
      .put("right", bounds.right)
      .put("bottom", bounds.bottom)
      .put("width", bounds.width())
      .put("height", bounds.height())
      .put("centerX", bounds.centerX())
      .put("centerY", bounds.centerY()))
    objectValue.put("clickable", node.isClickable)
    objectValue.put("longClickable", node.isLongClickable)
    objectValue.put("scrollable", node.isScrollable)
    objectValue.put("editable", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) node.isEditable else false)
    objectValue.put(
      "actionable",
      node.isClickable ||
        node.isLongClickable ||
        node.isScrollable ||
        (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2 && node.isEditable)
    )
    objectValue.put("enabled", node.isEnabled)
    objectValue.put("visibleToUser", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) node.isVisibleToUser else true)
    objectValue.put("focused", node.isFocused)
    objectValue.put("selected", node.isSelected)
    objectValue.put("checked", node.isChecked)

    if (depth < MAX_NODE_DEPTH && budget.count < MAX_NODE_COUNT) {
      val children = JSONArray()
      for (index in 0 until node.childCount) {
        if (budget.count >= MAX_NODE_COUNT) break
        val child = node.getChild(index) ?: continue
        children.put(serializeNode(child, "$path.$index", depth + 1, budget))
        child.recycle()
      }
      objectValue.put("children", children)
    }

    return objectValue
  }

  private fun findNodeByPath(path: String): AccessibilityNodeInfo? {
    val parts = path.split(".")
    if (parts.isEmpty()) return null

    val windowIndex = parts.first().removePrefix("w").toIntOrNull() ?: return null
    val root = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      windows.getOrNull(windowIndex)?.root
    } else {
      rootInActiveWindow
    } ?: return null

    var current = root
    for (part in parts.drop(1)) {
      val childIndex = part.toIntOrNull()
      if (childIndex == null || childIndex < 0 || childIndex >= current.childCount) {
        if (current !== root) current.recycle()
        root.recycle()
        return null
      }
      val child = current.getChild(childIndex)
      if (current !== root) current.recycle()
      current = child ?: run {
        root.recycle()
        return null
      }
    }
    return current
  }

  private fun runNodeAction(path: String, action: Int): ActionResult {
    val node = findNodeByPath(path)
      ?: return ActionResult(false, "Node not found: $path", collectNodeTree())
    return try {
      var target: AccessibilityNodeInfo? = node
      while (target != null) {
        if (target.performAction(action)) {
          return ActionResult(true, "Action performed on ${target.className ?: path}", collectNodeTree())
        }
        val parent = target.parent
        if (target !== node) target.recycle()
        target = parent
      }
      ActionResult(false, "Node and parents did not accept action: $path", collectNodeTree())
    } finally {
      node.recycle()
    }
  }

  private fun canSetText(node: AccessibilityNodeInfo): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2 && node.isEditable) return true
    return node.actionList.any { action -> action.id == AccessibilityNodeInfo.ACTION_SET_TEXT }
  }

  private fun findFirstTextTarget(node: AccessibilityNodeInfo, depth: Int = 0): AccessibilityNodeInfo? {
    if (canSetText(node)) return AccessibilityNodeInfo.obtain(node)
    if (depth >= MAX_TEXT_TARGET_SEARCH_DEPTH) return null

    for (index in 0 until node.childCount) {
      val child = node.getChild(index) ?: continue
      try {
        val target = findFirstTextTarget(child, depth + 1)
        if (target != null) return target
      } finally {
        child.recycle()
      }
    }

    return null
  }

  private fun runSetNodeText(path: String, text: String): ActionResult {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
      return ActionResult(false, "Setting text requires Android 5.0 or newer", collectNodeTree())
    }
    if (text.length > MAX_SET_TEXT_CHARS) {
      return ActionResult(false, "Text is too long: ${text.length} > $MAX_SET_TEXT_CHARS", collectNodeTree())
    }

    val node = findNodeByPath(path)
      ?: return ActionResult(false, "Node not found: $path", collectNodeTree())

    var target: AccessibilityNodeInfo? = null
    return try {
      target = findFirstTextTarget(node)
      val textTarget = target
        ?: return ActionResult(false, "No editable text target found under node: $path", collectNodeTree())

      textTarget.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
      val args = Bundle().apply {
        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
      }
      val success = textTarget.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
      ActionResult(
        success,
        if (success) {
          "Text set on ${textTarget.className ?: path}"
        } else {
          "Text target rejected ACTION_SET_TEXT: $path"
        },
        collectNodeTree()
      )
    } finally {
      target?.recycle()
      node.recycle()
    }
  }

  private fun findFocusedInputTarget(): AccessibilityNodeInfo? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      for (window in windows) {
        val root = window.root ?: continue
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (focused != null) return focused
      }
    }

    val root = rootInActiveWindow ?: return null
    return root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
  }

  private fun runSetFocusedText(text: String): ActionResult {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
      return ActionResult(false, "Setting text requires Android 5.0 or newer", collectNodeTree())
    }
    if (text.length > MAX_SET_TEXT_CHARS) {
      return ActionResult(false, "Text is too long: ${text.length} > $MAX_SET_TEXT_CHARS", collectNodeTree())
    }

    val focused = findFocusedInputTarget()
      ?: return ActionResult(false, "No focused input field found", collectNodeTree())

    var target: AccessibilityNodeInfo? = null
    return try {
      target = if (canSetText(focused)) focused else findFirstTextTarget(focused)
      val textTarget = target
      if (textTarget == null) {
        ActionResult(false, "Focused node does not accept ACTION_SET_TEXT", collectNodeTree())
      } else {
        val args = Bundle().apply {
          putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        val success = textTarget.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        ActionResult(
          success,
          if (success) {
            "Text set on focused ${textTarget.className ?: "input"}"
          } else {
            "Focused input rejected ACTION_SET_TEXT"
          },
          collectNodeTree()
        )
      }
    } finally {
      if (target != null && target !== focused) target?.recycle()
      focused.recycle()
    }
  }

  private fun isYSClaudeInputMethodCandidate(node: AccessibilityNodeInfo): Boolean {
    val expectedLabel = getString(R.string.ysclaude_ime_label).lowercase()
    val text = node.text?.toString()?.lowercase() ?: ""
    val description = node.contentDescription?.toString()?.lowercase() ?: ""
    return text.contains(expectedLabel) ||
      description.contains(expectedLabel) ||
      text.contains("ysclaude") ||
      description.contains("ysclaude")
  }

  private fun findYSClaudeInputMethodCandidate(
    node: AccessibilityNodeInfo,
    depth: Int = 0,
    budget: NodeBudget = NodeBudget()
  ): AccessibilityNodeInfo? {
    budget.count += 1
    if (isYSClaudeInputMethodCandidate(node)) return AccessibilityNodeInfo.obtain(node)
    if (depth >= MAX_INPUT_METHOD_PICKER_DEPTH || budget.count >= MAX_INPUT_METHOD_PICKER_NODES) return null

    for (index in 0 until node.childCount) {
      if (budget.count >= MAX_INPUT_METHOD_PICKER_NODES) break
      val child = node.getChild(index) ?: continue
      try {
        val candidate = findYSClaudeInputMethodCandidate(child, depth + 1, budget)
        if (candidate != null) return candidate
      } finally {
        child.recycle()
      }
    }

    return null
  }

  private fun findYSClaudeInputMethodCandidateInWindows(): AccessibilityNodeInfo? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      for (window in windows) {
        val root = window.root ?: continue
        try {
          val candidate = findYSClaudeInputMethodCandidate(root)
          if (candidate != null) return candidate
        } finally {
          root.recycle()
        }
      }
    }

    val root = rootInActiveWindow ?: return null
    return try {
      findYSClaudeInputMethodCandidate(root)
    } finally {
      root.recycle()
    }
  }

  private fun clickNodeOrClickableParent(node: AccessibilityNodeInfo): Boolean {
    var current: AccessibilityNodeInfo? = node
    var recycleCurrent = false
    while (current != null) {
      if (current.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
        if (recycleCurrent) current.recycle()
        return true
      }
      val parent = current.parent
      if (recycleCurrent) current.recycle()
      current = parent
      recycleCurrent = true
    }
    return false
  }

  private fun selectYSClaudeInputMethodFromPicker(callback: (Result<ActionResult>) -> Unit) {
    val startedAt = SystemClock.uptimeMillis()

    fun finish(success: Boolean, message: String) {
      callback(Result.success(ActionResult(success, message, collectNodeTreeOrNull())))
    }

    fun attempt() {
      val candidate = findYSClaudeInputMethodCandidateInWindows()
      if (candidate != null) {
        val clicked = try {
          clickNodeOrClickableParent(candidate)
        } finally {
          candidate.recycle()
        }
        finish(
          clicked,
          if (clicked) "Selected YSClaude IME from Android input method picker" else "Found YSClaude IME, but picker row rejected click"
        )
        return
      }

      if (SystemClock.uptimeMillis() - startedAt >= INPUT_METHOD_PICKER_TIMEOUT_MS) {
        finish(false, "YSClaude IME was not found in the Android input method picker. Enable it in input method settings first.")
        return
      }

      mainHandler.postDelayed({ attempt() }, INPUT_METHOD_PICKER_RETRY_MS)
    }

    attempt()
  }

  private fun collectNodeTreeOrNull(): String? {
    return runCatching { collectNodeTree() }.getOrNull()
  }

  private fun dispatchGestureWithTimeout(
    gesture: GestureDescription,
    successMessage: String,
    cancelledMessage: String,
    timeoutMessage: String,
    callback: (Result<ActionResult>) -> Unit
  ) {
    var finished = false
    lateinit var timeoutRunnable: Runnable

    fun finish(success: Boolean, message: String) {
      if (finished) return
      finished = true
      mainHandler.removeCallbacks(timeoutRunnable)
      callback(Result.success(ActionResult(success, message, collectNodeTreeOrNull())))
    }

    timeoutRunnable = Runnable {
      finish(false, timeoutMessage)
    }

    mainHandler.postDelayed(timeoutRunnable, GESTURE_TIMEOUT_MS)
    val dispatched = runCatching {
      dispatchGesture(gesture, object : GestureResultCallback() {
        override fun onCompleted(gestureDescription: GestureDescription?) {
          finish(true, successMessage)
        }

        override fun onCancelled(gestureDescription: GestureDescription?) {
          finish(false, cancelledMessage)
        }
      }, mainHandler)
    }.getOrElse { error ->
      finish(false, "Gesture dispatch failed: ${error.message ?: "unknown error"}")
      return
    }

    if (!dispatched) {
      finish(false, "Gesture dispatch was rejected by Android")
    }
  }

  private fun runTap(x: Float, y: Float, callback: (Result<ActionResult>) -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      callback(Result.failure(IllegalStateException("Gestures require Android 7.0 or newer")))
      return
    }

    val path = Path().apply { moveTo(x, y) }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, 90))
      .build()
    dispatchGestureWithTimeout(
      gesture = gesture,
      successMessage = "Tapped at ${x.toInt()},${y.toInt()}",
      cancelledMessage = "Tap cancelled",
      timeoutMessage = "Tap timed out",
      callback = callback
    )
  }

  private fun runSwipe(
    startX: Float,
    startY: Float,
    endX: Float,
    endY: Float,
    durationMs: Long,
    callback: (Result<ActionResult>) -> Unit
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      callback(Result.failure(IllegalStateException("Gestures require Android 7.0 or newer")))
      return
    }

    val path = Path().apply {
      moveTo(startX, startY)
      lineTo(endX, endY)
    }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(80, 2000)))
      .build()
    dispatchGestureWithTimeout(
      gesture = gesture,
      successMessage = "Swiped from ${startX.toInt()},${startY.toInt()} to ${endX.toInt()},${endY.toInt()}",
      cancelledMessage = "Swipe cancelled",
      timeoutMessage = "Swipe timed out",
      callback = callback
    )
  }

  private fun saveBitmap(bitmap: Bitmap): String {
    val dir = File(cacheDir, "screen-share")
    if (!dir.exists()) {
      dir.mkdirs()
    }
    val file = File(dir, "screen-${System.currentTimeMillis()}.jpg")
    FileOutputStream(file).use { output ->
      bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output)
    }
    return Uri.fromFile(file).toString()
  }

  private fun captureScreenContext(callback: (Result<ScreenContext>) -> Unit) {
    val nodeTree = collectNodeTree()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      callback(Result.success(ScreenContext(null, nodeTree)))
      return
    }

    takeScreenshot(0, Executor { command -> mainHandler.post(command) }, object : TakeScreenshotCallback {
      override fun onSuccess(screenshot: ScreenshotResult) {
        try {
          val bitmap = Bitmap.wrapHardwareBuffer(screenshot.hardwareBuffer, screenshot.colorSpace)
            ?: throw IllegalStateException("Unable to decode accessibility screenshot")
          val imageUri = saveBitmap(bitmap)
          screenshot.hardwareBuffer.close()
          callback(Result.success(ScreenContext(imageUri, nodeTree)))
        } catch (error: Throwable) {
          callback(Result.failure(error))
        }
      }

      override fun onFailure(errorCode: Int) {
        callback(Result.failure(IllegalStateException("Accessibility screenshot failed: $errorCode")))
      }
    })
  }

  private class NodeBudget {
    var count = 0
  }

  companion object {
    private const val MAX_NODE_DEPTH = 12
    private const val MAX_NODE_COUNT = 320
    private const val MAX_TEXT_TARGET_SEARCH_DEPTH = 5
    private const val MAX_SET_TEXT_CHARS = 4000
    private const val GESTURE_TIMEOUT_MS = 2800L
    private const val INPUT_METHOD_PICKER_TIMEOUT_MS = 2600L
    private const val INPUT_METHOD_PICKER_RETRY_MS = 120L
    private const val MAX_INPUT_METHOD_PICKER_DEPTH = 8
    private const val MAX_INPUT_METHOD_PICKER_NODES = 120

    @Volatile
    private var instance: FloatingAccessibilityService? = null

    fun isRunning(): Boolean = instance != null

    fun captureCurrentScreenContext(callback: (Result<ScreenContext>) -> Unit) {
      val service = instance
      if (service == null) {
        callback(Result.failure(IllegalStateException("Please enable the YSClaude accessibility service first")))
        return
      }
      service.mainHandler.post {
        service.captureScreenContext(callback)
      }
    }

    fun tap(x: Float, y: Float, callback: (Result<ActionResult>) -> Unit) {
      val service = instance
      if (service == null) {
        callback(Result.failure(IllegalStateException("Please enable the YSClaude accessibility service first")))
        return
      }
      service.mainHandler.post {
        service.runTap(x, y, callback)
      }
    }

    fun tapRelative(xRatio: Float, yRatio: Float, callback: (Result<ActionResult>) -> Unit) {
      val service = instance
      if (service == null) {
        callback(Result.failure(IllegalStateException("Please enable the YSClaude accessibility service first")))
        return
      }
      service.mainHandler.post {
        val width = service.resources.displayMetrics.widthPixels
        val height = service.resources.displayMetrics.heightPixels
        val x = xRatio.coerceIn(0f, 1f) * width
        val y = yRatio.coerceIn(0f, 1f) * height
        service.runTap(x, y, callback)
      }
    }

    fun swipe(
      startX: Float,
      startY: Float,
      endX: Float,
      endY: Float,
      durationMs: Long,
      callback: (Result<ActionResult>) -> Unit
    ) {
      val service = instance
      if (service == null) {
        callback(Result.failure(IllegalStateException("Please enable the YSClaude accessibility service first")))
        return
      }
      service.mainHandler.post {
        service.runSwipe(startX, startY, endX, endY, durationMs, callback)
      }
    }

    fun clickNode(path: String, callback: (Result<ActionResult>) -> Unit) {
      val service = instance
      if (service == null) {
        callback(Result.failure(IllegalStateException("Please enable the YSClaude accessibility service first")))
        return
      }
      service.mainHandler.post {
        callback(Result.success(service.runNodeAction(path, AccessibilityNodeInfo.ACTION_CLICK)))
      }
    }

    fun scrollNode(path: String, direction: String, callback: (Result<ActionResult>) -> Unit) {
      val service = instance
      if (service == null) {
        callback(Result.failure(IllegalStateException("Please enable the YSClaude accessibility service first")))
        return
      }
      val action = when (direction.lowercase()) {
        "backward", "up", "left", "previous" -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        else -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
      }
      service.mainHandler.post {
        callback(Result.success(service.runNodeAction(path, action)))
      }
    }

    fun setNodeText(path: String, text: String, callback: (Result<ActionResult>) -> Unit) {
      val service = instance
      if (service == null) {
        callback(Result.failure(IllegalStateException("Please enable the YSClaude accessibility service first")))
        return
      }
      service.mainHandler.post {
        callback(Result.success(service.runSetNodeText(path, text)))
      }
    }

    fun setFocusedText(text: String, callback: (Result<ActionResult>) -> Unit) {
      val service = instance
      if (service == null) {
        callback(Result.failure(IllegalStateException("Please enable the YSClaude accessibility service first")))
        return
      }
      service.mainHandler.post {
        callback(Result.success(service.runSetFocusedText(text)))
      }
    }

    fun selectYSClaudeInputMethod(callback: (Result<ActionResult>) -> Unit) {
      val service = instance
      if (service == null) {
        callback(Result.failure(IllegalStateException("Please enable the YSClaude accessibility service first")))
        return
      }
      service.mainHandler.post {
        service.selectYSClaudeInputMethodFromPicker(callback)
      }
    }

    fun globalAction(action: String, callback: (Result<ActionResult>) -> Unit) {
      val service = instance
      if (service == null) {
        callback(Result.failure(IllegalStateException("Please enable the YSClaude accessibility service first")))
        return
      }
      val actionId = when (action.lowercase()) {
        "back" -> GLOBAL_ACTION_BACK
        "home" -> GLOBAL_ACTION_HOME
        "recents" -> GLOBAL_ACTION_RECENTS
        "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
        "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
        else -> GLOBAL_ACTION_BACK
      }
      service.mainHandler.post {
        val success = service.performGlobalAction(actionId)
        callback(Result.success(ActionResult(success, "Global action: $action", service.collectNodeTree())))
      }
    }
  }
}
