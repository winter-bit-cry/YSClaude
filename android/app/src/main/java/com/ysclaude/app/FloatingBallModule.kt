package com.ysclaude.app

import android.animation.ValueAnimator
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.LinearGradient
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.content.pm.ServiceInfo
import android.text.TextUtils
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewOutlineProvider
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.bumptech.glide.Glide
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import androidx.core.app.NotificationCompat
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.random.Random

private data class DesktopLyricLine(
  val timeMs: Long,
  val durationMs: Long,
  val text: String
)

private fun ReadableMap.safeString(key: String): String {
  return if (hasKey(key) && !isNull(key)) {
    runCatching { getString(key).orEmpty() }.getOrDefault("")
  } else {
    ""
  }
}

private fun ReadableMap.safeDouble(key: String): Double {
  return if (hasKey(key) && !isNull(key)) {
    runCatching { getDouble(key) }.getOrDefault(0.0)
  } else {
    0.0
  }
}

class FloatingBallModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "FloatingBall"

  private val mainHandler = Handler(Looper.getMainLooper())
  private val windowManager = reactContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val defaultBallSize = ImageSize(dp(64), dp(64))
  private val touchTargetSize = dp(96)
  private val toolSize = dp(38)
  private val expandedWidth = dp(238)
  private val expandedHeight = dp(152)
  private val bubbleWidth = dp(268)
  private val inputWidth = dp(286)
  private val touchSlop = ViewConfiguration.get(reactContext).scaledTouchSlop
  private val dragSlop = max(touchSlop, dp(24))
  private val toolColors = listOf(
    Color.rgb(255, 232, 238),
    Color.rgb(232, 241, 255),
    Color.rgb(232, 248, 238),
    Color.rgb(255, 244, 214),
    Color.rgb(238, 235, 255)
  )

  private var rootView: FrameLayout? = null
  private var ballView: ImageView? = null
  private var bubbleView: TextView? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private val messageSequenceQueue = ArrayDeque<String>()
  private var messageSequenceIntervalMs = 2000L
  private var messageSequenceScheduled = false
  private var desktopLyricView: DesktopLyricCardView? = null
  private var desktopLyricParams: WindowManager.LayoutParams? = null
  private var inputView: LinearLayout? = null
  private var inputParams: WindowManager.LayoutParams? = null
  private var toolbarViews: List<View> = emptyList()
  private var layoutParams: WindowManager.LayoutParams? = null
  private var ballWidth = defaultBallSize.width
  private var ballHeight = defaultBallSize.height
  private var normalBallSize = defaultBallSize
  private var edgeBallSize = defaultBallSize
  private var customNormalImageUris: List<String> = emptyList()
  private var customEdgeImageUris: List<String> = emptyList()
  private var currentNormalImageUri = ""
  private var currentEdgeImageUri = ""
  private var assetAutoSwitchEnabled = false
  private var assetAutoSwitchIntervalMs = 8000L
  private var isExpanded = false
  private var isEdgeHanging = false
  private var edgeSide = EdgeSide.RIGHT
  private var currentNormalIndex = -1
  private var lastDownRawX = 0f
  private var lastDownRawY = 0f
  private var downEventTime = 0L
  private var downParamX = 0
  private var downParamY = 0
  private var desktopLyricLastRawX = 0f
  private var desktopLyricLastRawY = 0f
  private var desktopLyricDownParamX = 0
  private var desktopLyricDownParamY = 0
  private var desktopLyricDidDrag = false
  private var didDrag = false
  private var didLongPress = false

  private val longPressRunnable = Runnable {
    didLongPress = true
    if (isExpanded) {
      hideToolbar()
    } else {
      showToolbar()
    }
  }

  private val returnToIdleRunnable = Runnable {
    loadState(if (isEdgeHanging) EDGE_IDLE else NORMAL_IDLE)
  }

  private val hideMessageRunnable = Runnable {
    hideMessageInternal()
  }

  private val messageSequenceRunnable = object : Runnable {
    override fun run() {
      messageSequenceScheduled = false
      val next = messageSequenceQueue.removeFirstOrNull()
      if (next == null) {
        return
      }
      showMessageInternal(next, fromSequence = true)
      if (messageSequenceQueue.isNotEmpty()) {
        messageSequenceScheduled = true
        mainHandler.postDelayed(this, messageSequenceIntervalMs)
      }
    }
  }

  private val randomStateRunnable = object : Runnable {
    override fun run() {
      if (rootView != null && !isExpanded) {
        val pool = if (isEdgeHanging) EDGE_RANDOM_STATES else NORMAL_RANDOM_STATES
        val next = pool.random()
        loadState(next)
        mainHandler.removeCallbacks(returnToIdleRunnable)
        mainHandler.postDelayed(returnToIdleRunnable, 2600)
      }
      scheduleRandomState()
    }
  }

  @ReactMethod
  fun canDrawOverlays(promise: Promise) {
    promise.resolve(canDrawOverlays())
  }

  @ReactMethod
  fun openOverlaySettings(promise: Promise) {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${reactContext.packageName}")
      ).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("OPEN_OVERLAY_SETTINGS_FAILED", error)
    }
  }

  private val assetAutoSwitchRunnable = object : Runnable {
    override fun run() {
      if (rootView != null && !isExpanded && assetAutoSwitchEnabled) {
        val hasPool = if (isEdgeHanging) customEdgeImageUris.size > 1 else customNormalImageUris.size > 1
        if (hasPool) {
          loadState(if (isEdgeHanging) EDGE_IDLE else NORMAL_IDLE, true)
        }
      }
      scheduleAssetAutoSwitch()
    }
  }

  @ReactMethod
  fun configureAssets(
    normalUris: ReadableArray?,
    edgeUris: ReadableArray?,
    autoSwitchEnabled: Boolean,
    autoSwitchIntervalSeconds: Double,
    normalSizeDp: Double,
    edgeSizeDp: Double,
    promise: Promise
  ) {
    mainHandler.post {
      try {
        customNormalImageUris = readableArrayToStringList(normalUris)
        customEdgeImageUris = readableArrayToStringList(edgeUris)
        assetAutoSwitchEnabled = autoSwitchEnabled
        assetAutoSwitchIntervalMs = (autoSwitchIntervalSeconds.coerceIn(1.0, 3600.0) * 1000).toLong()
        normalBallSize = ballSizeFromDp(normalSizeDp)
        edgeBallSize = ballSizeFromDp(edgeSizeDp)
        currentNormalImageUri = if (currentNormalImageUri in customNormalImageUris) currentNormalImageUri else ""
        currentEdgeImageUri = if (currentEdgeImageUri in customEdgeImageUris) currentEdgeImageUri else ""
        if (rootView != null) {
          loadState(if (isEdgeHanging) EDGE_IDLE else NORMAL_IDLE)
        } else {
          applyBallImageSize(normalBallSize)
        }
        scheduleAssetAutoSwitch()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("CONFIGURE_FLOATING_BALL_ASSETS_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun show(promise: Promise) {
    mainHandler.post {
      try {
        if (!canDrawOverlays()) {
          promise.reject("OVERLAY_PERMISSION_REQUIRED", "Floating ball overlay permission is not granted")
          return@post
        }
        showInternal()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("SHOW_FLOATING_BALL_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun hide(promise: Promise) {
    mainHandler.post {
      try {
        hideInternal()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("HIDE_FLOATING_BALL_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun isShowing(promise: Promise) {
    promise.resolve(rootView != null)
  }

  @ReactMethod
  fun showMessage(text: String, promise: Promise) {
    mainHandler.post {
      try {
        stopMessageSequence()
        showMessageInternal(text)
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("SHOW_FLOATING_MESSAGE_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun enqueueMessageSequence(messages: ReadableArray, intervalMs: Double, reset: Boolean, promise: Promise) {
    mainHandler.post {
      try {
        if (reset) {
          stopMessageSequence()
        }
        messageSequenceIntervalMs = intervalMs.toLong().coerceAtLeast(250L)
        for (index in 0 until messages.size()) {
          val text = messages.getString(index)?.trim().orEmpty()
          if (text.isNotBlank()) {
            messageSequenceQueue.addLast(text)
          }
        }
        scheduleMessageSequence()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("ENQUEUE_FLOATING_MESSAGE_SEQUENCE_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun hideMessage(promise: Promise) {
    mainHandler.post {
      try {
        stopMessageSequence()
        hideMessageInternal()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("HIDE_FLOATING_MESSAGE_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun showDesktopLyric(
    text: String,
    lyricProgress: Double,
    title: String,
    artist: String,
    artworkUrl: String,
    songProgress: Double,
    isPlaying: Boolean,
    backgroundUri: String,
    promise: Promise
  ) {
    mainHandler.post {
      try {
        if (!canDrawOverlays()) {
          promise.reject("OVERLAY_PERMISSION_REQUIRED", "Desktop lyric overlay permission is not granted")
          return@post
        }
        showDesktopLyricInternal(
          text,
          lyricProgress,
          title,
          artist,
          artworkUrl,
          songProgress,
          isPlaying,
          backgroundUri,
          "lyrics",
          "",
          "",
          "",
          "",
          false
        )
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("SHOW_DESKTOP_LYRIC_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun showDesktopLyricPanel(
    text: String,
    lyricProgress: Double,
    title: String,
    artist: String,
    artworkUrl: String,
    songProgress: Double,
    isPlaying: Boolean,
    backgroundUri: String,
    panelMode: String,
    radioStatus: String,
    radioScript: String,
    radioTrack: String,
    radioActionLabel: String,
    radioActionEnabled: Boolean,
    promise: Promise
  ) {
    mainHandler.post {
      try {
        if (!canDrawOverlays()) {
          promise.reject("OVERLAY_PERMISSION_REQUIRED", "Desktop lyric overlay permission is not granted")
          return@post
        }
        showDesktopLyricInternal(
          text,
          lyricProgress,
          title,
          artist,
          artworkUrl,
          songProgress,
          isPlaying,
          backgroundUri,
          panelMode,
          radioStatus,
          radioScript,
          radioTrack,
          radioActionLabel,
          radioActionEnabled
        )
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("SHOW_DESKTOP_LYRIC_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun showDesktopLyricTimeline(
    text: String,
    lyricProgress: Double,
    title: String,
    artist: String,
    artworkUrl: String,
    songProgress: Double,
    isPlaying: Boolean,
    backgroundUri: String,
    panelMode: String,
    radioStatus: String,
    radioScript: String,
    radioTrack: String,
    radioActionLabel: String,
    radioActionEnabled: Boolean,
    lyrics: ReadableArray?,
    currentTimeMs: Double,
    durationMs: Double,
    promise: Promise
  ) {
    mainHandler.post {
      try {
        if (!canDrawOverlays()) {
          promise.reject("OVERLAY_PERMISSION_REQUIRED", "Desktop lyric overlay permission is not granted")
          return@post
        }
        showDesktopLyricInternal(
          text,
          lyricProgress,
          title,
          artist,
          artworkUrl,
          songProgress,
          isPlaying,
          backgroundUri,
          panelMode,
          radioStatus,
          radioScript,
          radioTrack,
          radioActionLabel,
          radioActionEnabled,
          readableArrayToLyricLines(lyrics),
          currentTimeMs.toLong(),
          durationMs.toLong()
        )
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("SHOW_DESKTOP_LYRIC_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun hideDesktopLyric(promise: Promise) {
    mainHandler.post {
      try {
        hideDesktopLyricInternal()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("HIDE_DESKTOP_LYRIC_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun openApp(promise: Promise) {
    try {
      openAppInternal()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("OPEN_APP_FAILED", error)
    }
  }

  @ReactMethod
  fun captureScreen(promise: Promise) {
    if (ScreenCaptureService.hasPendingCapture()) {
      promise.reject("SCREEN_CAPTURE_BUSY", "Screen capture is already active")
      return
    }

    ScreenCaptureService.setPendingPromise(promise)
    val intent = Intent(reactContext, ScreenCapturePermissionActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    try {
      reactContext.startActivity(intent)
    } catch (error: Exception) {
      ScreenCaptureService.clearPendingPromise()
      promise.reject("OPEN_SCREEN_CAPTURE_FAILED", error)
    }
  }

  private fun canDrawOverlays(): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(reactContext)
  }

  private fun overlayFlags(focusable: Boolean = false): Int {
    var flags = WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
      WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
    if (!focusable) {
      flags = flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
    }
    return flags
  }

  private fun showInternal() {
    if (rootView != null) return

    val root = FrameLayout(reactContext).apply {
      clipChildren = false
      clipToPadding = false
      setBackgroundColor(Color.TRANSPARENT)
      setOnTouchListener(::handleTouch)
    }

    val image = ImageView(reactContext).apply {
      scaleType = ImageView.ScaleType.CENTER
      setOnTouchListener(::handleTouch)
    }
    root.addView(image, collapsedBallLayoutParams())

    val labels = listOf("📷", "✎", "↻", "↗")
    val actions = listOf(
      ACTION_SCREEN_SHARE,
      ACTION_TEXT_INPUT,
      ACTION_GET_REPLY,
      ACTION_TOGGLE_MUSIC,
      ACTION_OPEN_APP
    )
    var labelIndex = 0
    val tools = actions.mapIndexed { index, action ->
      if (action == ACTION_TOGGLE_MUSIC) {
        ImageView(reactContext).apply {
          setImageResource(R.drawable.music)
          scaleType = ImageView.ScaleType.CENTER_INSIDE
          setPadding(dp(10), dp(10), dp(10), dp(10))
          background = circleDrawable(toolColors[index])
          elevation = dp(5).toFloat()
          alpha = 0.96f
          visibility = View.GONE
          setOnClickListener {
            handleToolAction(action)
          }
        }
      } else {
        TextView(reactContext).apply {
          text = labels[labelIndex++]
          textSize = 18f
          setTextColor(Color.rgb(86, 82, 92))
          gravity = Gravity.CENTER
          background = circleDrawable(toolColors[index])
          elevation = dp(5).toFloat()
          alpha = 0.96f
          visibility = View.GONE
          setOnClickListener {
            handleToolAction(action)
          }
          if (action == ACTION_SCREEN_SHARE) {
            setOnLongClickListener {
              handleToolAction(ACTION_SCREEN_CONTROL)
              true
            }
          }
        }
      }
    }
    tools.forEach { root.addView(it, FrameLayout.LayoutParams(toolSize, toolSize)) }

    rootView = root
    ballView = image
    toolbarViews = tools
    isExpanded = false
    isEdgeHanging = false
    edgeSide = EdgeSide.RIGHT

    layoutParams = WindowManager.LayoutParams(
      collapsedWidth(),
      collapsedHeight(),
      overlayType(),
      overlayFlags(),
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = screenWidth() - collapsedWidth() - dp(18)
      y = screenHeight() / 2 - collapsedHeight() / 2
    }

    windowManager.addView(root, layoutParams)
    FloatingBallForegroundService.start(reactContext)
    loadState(NORMAL_IDLE)
    scheduleRandomState()
    scheduleAssetAutoSwitch()
  }

  private fun hideInternal() {
    mainHandler.removeCallbacks(longPressRunnable)
    mainHandler.removeCallbacks(returnToIdleRunnable)
    mainHandler.removeCallbacks(randomStateRunnable)
    mainHandler.removeCallbacks(assetAutoSwitchRunnable)
    mainHandler.removeCallbacks(hideMessageRunnable)
    hideMessageInternal()
    hideTextInputInternal()
    rootView?.let { view ->
      runCatching { windowManager.removeView(view) }
    }
    rootView = null
    ballView = null
    toolbarViews = emptyList()
    layoutParams = null
    isExpanded = false
    isEdgeHanging = false
    stopForegroundServiceIfNoOverlay()
  }

  private fun stopForegroundServiceIfNoOverlay() {
    if (rootView == null && desktopLyricView == null) {
      FloatingBallForegroundService.stop(reactContext)
    }
  }

  private fun handleTouch(view: View, event: MotionEvent): Boolean {
    val params = layoutParams ?: return true
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        hideMessageInternal()
        lastDownRawX = event.rawX
        lastDownRawY = event.rawY
        downEventTime = event.eventTime
        downParamX = params.x
        downParamY = params.y
        didDrag = false
        didLongPress = false
        mainHandler.removeCallbacks(longPressRunnable)
        mainHandler.postDelayed(longPressRunnable, ViewConfiguration.getLongPressTimeout().toLong())
        return true
      }

      MotionEvent.ACTION_MOVE -> {
        if (didLongPress) {
          return true
        }
        val dx = event.rawX - lastDownRawX
        val dy = event.rawY - lastDownRawY
        if (!didDrag && (abs(dx) > dragSlop || abs(dy) > dragSlop)) {
          didDrag = true
          mainHandler.removeCallbacks(longPressRunnable)
          hideToolbar()
          isEdgeHanging = false
          loadState(NORMAL_IDLE)
        }
        if (didDrag) {
          params.x = (downParamX + dx).toInt()
          params.y = (downParamY + dy).toInt().coerceIn(0, screenHeight() - collapsedHeight())
          rootView?.let { windowManager.updateViewLayout(it, params) }
        }
        return true
      }

      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        mainHandler.removeCallbacks(longPressRunnable)
        if (didDrag) {
          settleAfterDrag()
        } else if (!didLongPress && event.actionMasked == MotionEvent.ACTION_UP) {
          val pressDuration = event.eventTime - downEventTime
          if (pressDuration >= ViewConfiguration.getLongPressTimeout()) {
            didLongPress = true
            showToolbar()
          } else {
            handleClick()
          }
        }
        didDrag = false
        didLongPress = false
        return true
      }
    }
    return true
  }

  private fun handleClick() {
    hideMessageInternal()
    if (isExpanded) {
      hideToolbar()
      return
    }
    if (isEdgeHanging) {
      exitEdge()
      return
    }
    currentNormalIndex = (currentNormalIndex + 1).floorMod(NORMAL_CLICK_STATES.size)
    loadState(NORMAL_CLICK_STATES[currentNormalIndex], true)
    mainHandler.removeCallbacks(returnToIdleRunnable)
    mainHandler.postDelayed(returnToIdleRunnable, 3200)
  }

  private fun handleToolAction(action: String) {
    hideToolbar()
    hideMessageInternal()
    if (action == ACTION_TEXT_INPUT) {
      showTextInput()
      return
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(TOOL_ACTION_EVENT, action)
    if (action == ACTION_OPEN_APP) {
      openAppInternal()
      return
    }
  }

  private fun openAppInternal() {
    val launchIntent = reactContext.packageManager.getLaunchIntentForPackage(reactContext.packageName)
      ?: Intent(reactContext, MainActivity::class.java)
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    reactContext.startActivity(launchIntent)
  }

  private fun showTextInput() {
    hideTextInputInternal()
    val params = layoutParams ?: return

    val input = EditText(reactContext).apply {
      hint = "输入文字"
      setHintTextColor(Color.rgb(150, 144, 156))
      setTextColor(Color.rgb(43, 40, 48))
      textSize = 14f
      setSingleLine(true)
      imeOptions = EditorInfo.IME_ACTION_SEND or EditorInfo.IME_FLAG_NO_EXTRACT_UI
      setPadding(dp(10), 0, dp(8), 0)
      background = null
      minHeight = dp(42)
    }

    val send = TextView(reactContext).apply {
      text = "发送"
      textSize = 14f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      background = roundedDrawable(Color.rgb(121, 103, 238), dp(16))
      setPadding(dp(12), 0, dp(12), 0)
    }

    val close = TextView(reactContext).apply {
      text = "×"
      textSize = 20f
      setTextColor(Color.rgb(134, 128, 140))
      gravity = Gravity.CENTER
      setPadding(dp(6), 0, dp(6), 0)
      setOnClickListener { hideTextInputInternal() }
    }

    val container = LinearLayout(reactContext).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(10), dp(8), dp(8), dp(8))
      background = roundedDrawable(Color.rgb(255, 255, 255), dp(18))
      elevation = dp(8).toFloat()
      addView(
        input,
        LinearLayout.LayoutParams(0, dp(42), 1f)
      )
      addView(
        send,
        LinearLayout.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT, dp(36))
      )
      addView(
        close,
        LinearLayout.LayoutParams(dp(34), dp(36))
      )
    }

    val submit = {
      val text = input.text?.toString()?.trim().orEmpty()
      if (text.isNotEmpty()) {
        hideTextInputInternal()
        emitTextInput(text)
      }
      Unit
    }

    input.setOnEditorActionListener { _, actionId, _ ->
      if (actionId == EditorInfo.IME_ACTION_SEND) {
        submit()
        true
      } else {
        false
      }
    }
    send.setOnClickListener { submit() }

    val targetX = (params.x + currentBallLeft() + ballWidth / 2 - inputWidth / 2)
      .coerceIn(dp(8), screenWidth() - inputWidth - dp(8))
    val targetY = (params.y - dp(62)).coerceIn(dp(8), screenHeight() - dp(118))
    inputParams = WindowManager.LayoutParams(
      inputWidth,
      WindowManager.LayoutParams.WRAP_CONTENT,
      overlayType(),
      overlayFlags(focusable = true),
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = targetX
      y = targetY
      softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING or
        WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE
    }

    inputView = container
    windowManager.addView(container, inputParams)
    input.requestFocus()
    mainHandler.postDelayed({
      val imm = reactContext.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }, 120)
  }

  private fun emitTextInput(text: String) {
    val payload = Arguments.createMap().apply {
      putString("action", ACTION_TEXT_INPUT)
      putString("text", text)
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(TOOL_ACTION_EVENT, payload)
  }

  private fun hideTextInputInternal() {
    val input = inputView
    if (input != null) {
      val imm = reactContext.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      runCatching { imm.hideSoftInputFromWindow(input.windowToken, 0) }
      runCatching { windowManager.removeView(input) }
    }
    inputView = null
    inputParams = null
  }

  private fun settleAfterDrag() {
    val root = rootView ?: return
    val params = layoutParams ?: return
    val width = screenWidth()
    val ballLeft = currentBallLeft()
    val centerX = params.x + ballLeft + ballWidth / 2
    edgeSide = if (centerX < width / 2) EdgeSide.LEFT else EdgeSide.RIGHT
    val nearLeft = params.x + ballLeft <= dp(20)
    val nearRight = params.x + ballLeft + ballWidth >= width - dp(20)

    if (nearLeft || nearRight) {
      isEdgeHanging = true
      updateCollapsedBallLayout()
      params.width = collapsedWidth()
      params.height = collapsedHeight()
      params.x = if (edgeSide == EdgeSide.LEFT) 0 else width - collapsedWidth()
      params.y = params.y.coerceIn(0, screenHeight() - collapsedHeight())
      windowManager.updateViewLayout(root, params)
      loadState(EDGE_IDLE, true)
      updateMessagePosition()
      return
    }

    isEdgeHanging = false
    updateCollapsedBallLayout()
    params.width = collapsedWidth()
    params.height = collapsedHeight()
    params.x = params.x.coerceIn(0, width - collapsedWidth())
    params.y = params.y.coerceIn(0, screenHeight() - collapsedHeight())
    windowManager.updateViewLayout(root, params)
    loadState(NORMAL_IDLE)
    updateMessagePosition()
  }

  private fun exitEdge() {
    val root = rootView ?: return
    val params = layoutParams ?: return
    isEdgeHanging = false
    updateCollapsedBallLayout()
    params.width = collapsedWidth()
    params.height = collapsedHeight()
    params.x = if (edgeSide == EdgeSide.LEFT) 0 else screenWidth() - collapsedWidth()
    params.y = params.y.coerceIn(0, screenHeight() - collapsedHeight())
    windowManager.updateViewLayout(root, params)
    loadState(NORMAL_IDLE)
    updateMessagePosition()
  }

  private fun showToolbar() {
    hideMessageInternal()
    val root = rootView ?: return
    val params = layoutParams ?: return
    val ball = ballView
    val ballScreenX = params.x + currentBallLeft()
    val ballScreenY = params.y + currentBallTop()
    val openToRight = ballScreenX + ballWidth / 2 < screenWidth() / 2
    edgeSide = if (openToRight) EdgeSide.LEFT else EdgeSide.RIGHT

    // Keep the overlay hidden while both the window bounds and child margins change.
    // Otherwise Android can draw one intermediate frame with the ball shifted.
    root.visibility = View.INVISIBLE
    ball?.visibility = View.VISIBLE
    isExpanded = true
    isEdgeHanging = false
    params.width = expandedWidth
    params.height = expandedHeight
    val ballLeft = expandedWidth / 2 - ballWidth / 2
    val ballTop = expandedHeight - ballHeight - dp(8)
    params.x = (ballScreenX - ballLeft).coerceIn(0, screenWidth() - expandedWidth)
    params.y = (ballScreenY - ballTop).coerceIn(0, screenHeight() - expandedHeight)

    ball?.layoutParams = FrameLayout.LayoutParams(ballWidth, ballHeight).apply {
      leftMargin = ballLeft
      topMargin = ballTop
    }

    val ballCenterX = ballLeft + ballWidth / 2
    val ballCenterY = ballTop + ballHeight / 2
    val positions = listOf(
      (ballCenterX - dp(80) - toolSize / 2) to (ballCenterY - dp(22) - toolSize / 2),
      (ballCenterX - dp(46) - toolSize / 2) to (ballCenterY - dp(62) - toolSize / 2),
      (ballCenterX - toolSize / 2) to (ballCenterY - dp(78) - toolSize / 2),
      (ballCenterX + dp(46) - toolSize / 2) to (ballCenterY - dp(62) - toolSize / 2),
      (ballCenterX + dp(80) - toolSize / 2) to (ballCenterY - dp(22) - toolSize / 2)
    )
    toolbarViews.forEachIndexed { index, tool ->
      val (left, top) = positions[index]
      tool.layoutParams = FrameLayout.LayoutParams(toolSize, toolSize).apply {
        leftMargin = left
        topMargin = top
      }
      tool.visibility = View.VISIBLE
    }
    windowManager.updateViewLayout(root, params)
    loadState(NORMAL_IDLE)
    root.post {
      if (rootView === root && isExpanded) {
        root.visibility = View.VISIBLE
      }
    }
  }

  private fun hideToolbar() {
    if (!isExpanded) return
    val params = layoutParams ?: return
    val root = rootView ?: return
    val ball = ballView
    val ballScreenX = params.x + currentBallLeft()
    val ballScreenY = params.y + currentBallTop()

    root.visibility = View.INVISIBLE
    ball?.visibility = View.VISIBLE
    isExpanded = false
    toolbarViews.forEach { it.visibility = View.GONE }
    updateCollapsedBallLayout()

    params.width = collapsedWidth()
    params.height = collapsedHeight()
    params.x = (ballScreenX - collapsedBallLeft()).coerceIn(0, screenWidth() - collapsedWidth())
    params.y = (ballScreenY - collapsedBallTop()).coerceIn(0, screenHeight() - collapsedHeight())
    windowManager.updateViewLayout(root, params)
    loadState(NORMAL_IDLE)
    updateMessagePosition()
    root.post {
      if (rootView === root && !isExpanded) {
        root.visibility = View.VISIBLE
      }
    }
  }

  private fun showMessageInternal(rawText: String, fromSequence: Boolean = false) {
    if (rootView == null || layoutParams == null || isExpanded) return
    val text = normalizeMessageText(rawText)
    if (text.isBlank()) return

    val bubble = bubbleView ?: TextView(reactContext).apply {
      textSize = 14f
      setTextColor(Color.rgb(58, 55, 62))
      setLineSpacing(dp(2).toFloat(), 1.0f)
      maxLines = 3
      ellipsize = TextUtils.TruncateAt.END
      includeFontPadding = true
      setPadding(dp(14), dp(10), dp(14), dp(10))
      background = messageBubbleDrawable()
      elevation = dp(8).toFloat()
    }.also {
      bubbleView = it
    }

    bubble.text = text
    if (bubble.parent == null) {
      bubbleParams = WindowManager.LayoutParams(
        bubbleWidth,
        WindowManager.LayoutParams.WRAP_CONTENT,
        overlayType(),
        overlayFlags() or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
        android.graphics.PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.TOP or Gravity.START
      }
      windowManager.addView(bubble, bubbleParams)
    }

    updateMessagePosition()
    mainHandler.removeCallbacks(hideMessageRunnable)
    mainHandler.postDelayed(hideMessageRunnable, 7200)
    if (!fromSequence) {
      stopMessageSequence()
    }
  }

  private fun hideMessageInternal() {
    mainHandler.removeCallbacks(hideMessageRunnable)
    bubbleView?.let { view ->
      if (view.parent != null) {
        runCatching { windowManager.removeView(view) }
      }
    }
    bubbleView = null
    bubbleParams = null
  }

  private fun scheduleMessageSequence() {
    if (!messageSequenceScheduled && messageSequenceQueue.isNotEmpty()) {
      messageSequenceScheduled = true
      mainHandler.postDelayed(messageSequenceRunnable, messageSequenceIntervalMs)
    }
  }

  private fun stopMessageSequence() {
    mainHandler.removeCallbacks(messageSequenceRunnable)
    messageSequenceScheduled = false
    messageSequenceQueue.clear()
  }

  private fun showDesktopLyricInternal(
    rawText: String,
    rawLyricProgress: Double,
    rawTitle: String,
    rawArtist: String,
    rawArtworkUrl: String,
    rawSongProgress: Double,
    isPlaying: Boolean,
    rawBackgroundUri: String,
    rawPanelMode: String,
    rawRadioStatus: String,
    rawRadioScript: String,
    rawRadioTrack: String,
    rawRadioActionLabel: String,
    radioActionEnabled: Boolean,
    lyrics: List<DesktopLyricLine> = emptyList(),
    currentTimeMs: Long = 0L,
    durationMs: Long = 0L
  ) {
    val text = normalizeDesktopLyricText(rawText)
    if (text.isBlank()) {
      hideDesktopLyricInternal()
      return
    }

    FloatingBallForegroundService.start(reactContext)

    val lyric = desktopLyricView ?: DesktopLyricCardView(reactContext, ::emitDesktopLyricAction).apply {
      elevation = 0f
      translationZ = 0f
      setOnTouchListener(::handleDesktopLyricTouch)
    }.also {
      desktopLyricView = it
    }

    lyric.update(
      text,
      rawLyricProgress.toFloat(),
      normalizeDesktopLyricText(rawTitle).ifBlank { "YSClaude Music" },
      normalizeDesktopLyricText(rawArtist),
      rawArtworkUrl.trim(),
      rawSongProgress.toFloat(),
      isPlaying,
      rawBackgroundUri.trim(),
      rawPanelMode.trim(),
      normalizeDesktopLyricText(rawRadioStatus),
      normalizeDesktopLyricText(rawRadioScript),
      normalizeDesktopLyricText(rawRadioTrack),
      normalizeDesktopLyricText(rawRadioActionLabel),
      radioActionEnabled,
      lyrics,
      currentTimeMs,
      durationMs
    )
    if (lyric.parent == null) {
      val width = (screenWidth() * 0.7f).toInt()
      desktopLyricParams = WindowManager.LayoutParams(
        width,
        lyric.preferredHeight(),
        overlayType(),
        overlayFlags(),
        android.graphics.PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = (screenWidth() - width) / 2
        y = (screenHeight() - dp(190)).coerceAtLeast(dp(24))
      }
      windowManager.addView(lyric, desktopLyricParams)
    } else {
      desktopLyricParams?.let { params ->
        params.height = lyric.preferredHeight()
        runCatching { windowManager.updateViewLayout(lyric, params) }
      }
    }
  }

  private fun hideDesktopLyricInternal() {
    desktopLyricView?.let { view ->
      if (view.parent != null) {
        runCatching { windowManager.removeView(view) }
      }
    }
    desktopLyricView = null
    desktopLyricParams = null
    stopForegroundServiceIfNoOverlay()
  }

  private fun handleDesktopLyricTouch(view: View, event: MotionEvent): Boolean {
    val params = desktopLyricParams ?: return true
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        desktopLyricLastRawX = event.rawX
        desktopLyricLastRawY = event.rawY
        desktopLyricDownParamX = params.x
        desktopLyricDownParamY = params.y
        desktopLyricDidDrag = false
        return true
      }

      MotionEvent.ACTION_MOVE -> {
        val dx = event.rawX - desktopLyricLastRawX
        val dy = event.rawY - desktopLyricLastRawY
        desktopLyricDidDrag = desktopLyricDidDrag || abs(dx) > touchSlop || abs(dy) > touchSlop
        params.x = (desktopLyricDownParamX + dx).toInt()
          .coerceIn(0, (screenWidth() - params.width).coerceAtLeast(0))
        params.y = (desktopLyricDownParamY + dy).toInt()
          .coerceIn(dp(12), screenHeight() - dp(80))
        runCatching { windowManager.updateViewLayout(view, params) }
        return true
      }

      MotionEvent.ACTION_UP -> {
        if (!desktopLyricDidDrag) {
          (view as? DesktopLyricCardView)?.toggleExpanded()
          params.height = (view as? DesktopLyricCardView)?.preferredHeight() ?: params.height
          runCatching { windowManager.updateViewLayout(view, params) }
        }
        return true
      }
    }
    return true
  }

  private fun emitDesktopLyricAction(action: String) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(DESKTOP_LYRIC_ACTION_EVENT, action)
  }

  private fun updateMessagePosition() {
    val params = layoutParams ?: return
    val bubble = bubbleView ?: return
    val bubbleLayout = bubbleParams ?: return
    if (bubble.parent == null) return

    val ballCenterX = params.x + currentBallLeft() + ballWidth / 2
    val desiredX = if (isEdgeHanging && edgeSide == EdgeSide.LEFT) {
      params.x + currentBallLeft() + ballWidth - dp(8)
    } else if (isEdgeHanging && edgeSide == EdgeSide.RIGHT) {
      params.x + currentBallLeft() - bubbleWidth + dp(8)
    } else {
      ballCenterX - bubbleWidth / 2
    }
    bubbleLayout.x = desiredX.coerceIn(dp(8), screenWidth() - bubbleWidth - dp(8))
    bubbleLayout.y = (params.y - dp(86)).coerceAtLeast(dp(18))
    windowManager.updateViewLayout(bubble, bubbleLayout)
  }

  private fun normalizeMessageText(rawText: String): String {
    return rawText
      .replace(Regex("\\[/?[^\\]]{1,24}\\]"), "")
      .replace(Regex("\\n{3,}"), "\n\n")
      .trim()
      .let { text ->
        if (text.length > 180) text.take(180).trimEnd() + "..." else text
      }
  }

  private fun normalizeDesktopLyricText(rawText: String): String {
    return rawText
      .replace(Regex("\\s+"), " ")
      .trim()
      .let { text ->
        if (text.length > 120) text.take(120).trimEnd() + "..." else text
      }
  }

  private fun circleDrawable(color: Int): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(color)
      setStroke(dp(1), Color.argb(80, 255, 255, 255))
    }
  }

  private fun defaultBallDrawable(isEdgeState: Boolean): GradientDrawable {
    val colors = if (isEdgeState) {
      intArrayOf(Color.rgb(245, 247, 255), Color.rgb(152, 168, 232))
    } else {
      intArrayOf(Color.rgb(255, 251, 242), Color.rgb(232, 176, 116))
    }
    return GradientDrawable(GradientDrawable.Orientation.TL_BR, colors).apply {
      shape = GradientDrawable.OVAL
      setStroke(dp(1), Color.argb(150, 255, 255, 255))
    }
  }

  private fun roundedDrawable(color: Int, radius: Int): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      cornerRadius = radius.toFloat()
      setColor(color)
    }
  }

  private fun messageBubbleDrawable(): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      cornerRadius = dp(16).toFloat()
      setColor(Color.argb(244, 255, 252, 245))
      setStroke(dp(1), Color.argb(96, 224, 215, 198))
    }
  }

  private fun loadState(assetName: String, forceRandom: Boolean = false) {
    val image = ballView ?: return
    val isEdgeState = assetName.startsWith("edge-") || isEdgeHanging
    val customUris = if (isEdgeState) customEdgeImageUris else customNormalImageUris
    val currentUri = if (isEdgeState) currentEdgeImageUri else currentNormalImageUri
    val customUri = when {
      forceRandom || currentUri.isBlank() -> pickRandomBallUri(customUris).also {
        if (isEdgeState) {
          currentEdgeImageUri = it
        } else {
          currentNormalImageUri = it
        }
      }
      else -> currentUri
    }
    applyBallImageSize(if (isEdgeState) edgeBallSize else normalBallSize)
    image.scaleX = if (isEdgeHanging && edgeSide == EdgeSide.LEFT) -1f else 1f
    if (customUri.isBlank()) {
      Glide.with(reactContext).clear(image)
      image.setImageDrawable(null)
      image.scaleType = ImageView.ScaleType.CENTER
      image.background = defaultBallDrawable(isEdgeState)
      return
    }

    image.background = null
    image.scaleType = ImageView.ScaleType.FIT_CENTER
    Glide.with(reactContext)
      .load(customUri)
      .into(image)
  }

  private fun pickRandomBallUri(uris: List<String>): String {
    if (uris.isEmpty()) return ""
    if (uris.size == 1) return uris[0]
    return uris[Random.nextInt(uris.size)]
  }

  private fun readableArrayToStringList(array: ReadableArray?): List<String> {
    if (array == null) return emptyList()
    val values = mutableListOf<String>()
    val seen = mutableSetOf<String>()
    for (index in 0 until array.size()) {
      val value = array.getString(index)?.trim().orEmpty()
      if (value.isBlank() || seen.contains(value)) continue
      seen.add(value)
      values.add(value)
    }
    return values
  }

  private fun readableArrayToLyricLines(array: ReadableArray?): List<DesktopLyricLine> {
    if (array == null) return emptyList()
    val values = mutableListOf<DesktopLyricLine>()
    for (index in 0 until array.size()) {
      val line = runCatching { array.getMap(index) }.getOrNull() ?: continue
      val text = normalizeDesktopLyricText(line.safeString("text"))
      if (text.isBlank()) continue
      val timeMs = line.safeDouble("timeMs").toLong().coerceAtLeast(0L)
      val durationMs = line.safeDouble("durationMs").toLong().coerceAtLeast(0L)
      values.add(DesktopLyricLine(timeMs, durationMs, text))
    }
    return values.sortedBy { it.timeMs }
  }

  private fun ballSizeFromDp(sizeDp: Double): ImageSize {
    val px = dp(sizeDp.coerceIn(MIN_BALL_SIZE_DP, MAX_BALL_SIZE_DP).toInt())
    return ImageSize(px, px)
  }

  private fun applyBallImageSize(nextSize: ImageSize) {
    if (nextSize.width == ballWidth && nextSize.height == ballHeight) return

    ballWidth = nextSize.width
    ballHeight = nextSize.height

    if (isExpanded) {
      val currentImageParams = ballView?.layoutParams as? FrameLayout.LayoutParams
      ballView?.layoutParams = FrameLayout.LayoutParams(ballWidth, ballHeight).apply {
        leftMargin = currentImageParams?.leftMargin ?: 0
        topMargin = currentImageParams?.topMargin ?: 0
      }
    } else {
      updateCollapsedBallLayout()
    }

    val root = rootView ?: return
    val params = layoutParams ?: return
    if (isExpanded) return

    params.width = collapsedWidth()
    params.height = collapsedHeight()
    params.x = if (isEdgeHanging) {
      if (edgeSide == EdgeSide.LEFT) 0 else screenWidth() - collapsedWidth()
    } else {
      params.x.coerceIn(0, screenWidth() - collapsedWidth())
    }
    params.y = params.y.coerceIn(0, screenHeight() - collapsedHeight())
    windowManager.updateViewLayout(root, params)
    updateMessagePosition()
  }

  private fun collapsedWidth(): Int = max(touchTargetSize, ballWidth)

  private fun collapsedHeight(): Int = max(touchTargetSize, ballHeight)

  private fun collapsedBallLeft(): Int {
    return if (edgeSide == EdgeSide.LEFT) 0 else collapsedWidth() - ballWidth
  }

  private fun collapsedBallTop(): Int = (collapsedHeight() - ballHeight) / 2

  private fun collapsedBallLayoutParams(): FrameLayout.LayoutParams {
    return FrameLayout.LayoutParams(ballWidth, ballHeight).apply {
      leftMargin = collapsedBallLeft()
      topMargin = collapsedBallTop()
    }
  }

  private fun updateCollapsedBallLayout() {
    ballView?.layoutParams = collapsedBallLayoutParams()
  }

  private fun currentBallLeft(): Int {
    val params = ballView?.layoutParams as? FrameLayout.LayoutParams
    return params?.leftMargin ?: ballView?.left ?: 0
  }

  private fun currentBallTop(): Int {
    val params = ballView?.layoutParams as? FrameLayout.LayoutParams
    return params?.topMargin ?: ballView?.top ?: 0
  }

  private fun scheduleRandomState() {
    mainHandler.removeCallbacks(randomStateRunnable)
    mainHandler.postDelayed(randomStateRunnable, Random.nextLong(9000, 18000))
  }

  private fun scheduleAssetAutoSwitch() {
    mainHandler.removeCallbacks(assetAutoSwitchRunnable)
    if (!assetAutoSwitchEnabled || rootView == null) return
    mainHandler.postDelayed(assetAutoSwitchRunnable, assetAutoSwitchIntervalMs)
  }

  private fun overlayType(): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
  }

  private fun screenSize(): Pair<Int, Int> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = windowManager.currentWindowMetrics.bounds
      return bounds.width() to bounds.height()
    }

    val metrics = DisplayMetrics()
    @Suppress("DEPRECATION")
    windowManager.defaultDisplay.getRealMetrics(metrics)
    return metrics.widthPixels to metrics.heightPixels
  }

  private fun screenWidth(): Int = screenSize().first

  private fun screenHeight(): Int = screenSize().second

  private fun dp(value: Int): Int = (value * reactContext.resources.displayMetrics.density).toInt()

  private fun Int.floorMod(other: Int): Int = ((this % other) + other) % other

  private enum class EdgeSide {
    LEFT,
    RIGHT
  }

  private data class ImageSize(val width: Int, val height: Int)

  companion object {
    private const val TOOL_ACTION_EVENT = "FloatingBallToolAction"
    private const val DESKTOP_LYRIC_ACTION_EVENT = "DesktopLyricAction"
    private const val ACTION_SCREEN_SHARE = "screen_share"
    private const val ACTION_SCREEN_CONTROL = "screen_control"
    private const val ACTION_TEXT_INPUT = "text_input"
    private const val ACTION_GET_REPLY = "get_reply"
    private const val ACTION_TOGGLE_MUSIC = "toggle_music"
    private const val ACTION_OPEN_APP = "open_app"
    private const val MIN_BALL_SIZE_DP = 32.0
    private const val MAX_BALL_SIZE_DP = 160.0

    private const val NORMAL_IDLE = "normal-idle"
    private const val EDGE_IDLE = "edge-idle"

    private val NORMAL_CLICK_STATES = listOf(
      "normal-active"
    )

    private val NORMAL_RANDOM_STATES = NORMAL_CLICK_STATES

    private val EDGE_RANDOM_STATES = listOf(
      "edge-active"
    )
  }
}

class ScreenCapturePermissionActivity : Activity() {
  private var requested = false

  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    if (savedInstanceState != null) {
      requested = savedInstanceState.getBoolean(KEY_REQUESTED, false)
    }
    if (!requested) {
      requested = true
      val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      startActivityForResult(projectionManager.createScreenCaptureIntent(), REQUEST_SCREEN_CAPTURE)
    }
  }

  override fun onSaveInstanceState(outState: android.os.Bundle) {
    outState.putBoolean(KEY_REQUESTED, requested)
    super.onSaveInstanceState(outState)
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode == REQUEST_SCREEN_CAPTURE) {
      if (resultCode == RESULT_OK && data != null) {
        ScreenCaptureService.capture(applicationContext, resultCode, data)
      } else {
        ScreenCaptureService.resolvePending(null)
      }
      finish()
      overridePendingTransition(0, 0)
    }
  }

  companion object {
    private const val REQUEST_SCREEN_CAPTURE = 5102
    private const val KEY_REQUESTED = "requested"
  }
}

private class DesktopLyricCardView(
  context: Context,
  private val onAction: (String) -> Unit
) : FrameLayout(context) {
  private val backgroundView = RoundedImageView(context) { dp(18).toFloat() }.apply {
    scaleType = ImageView.ScaleType.FIT_XY
    visibility = View.GONE
  }
  private val lyricText = DesktopLyricTextView(context).apply {
    textSize = 17f
    gravity = Gravity.CENTER
    maxLines = 2
    ellipsize = TextUtils.TruncateAt.END
    includeFontPadding = false
    setLineSpacing(dp(2).toFloat(), 1.0f)
    setTextColor(Color.WHITE)
    setShadowLayer(dp(2).toFloat(), 0f, dp(1).toFloat(), Color.argb(88, 0, 0, 0))
  }
  private val coverView = ImageView(context).apply {
    scaleType = ImageView.ScaleType.CENTER_CROP
    background = roundedDrawable(Color.argb(82, 255, 255, 255), dp(12))
  }
  private val titleView = TextView(context).apply {
    textSize = 15f
    setTextColor(Color.rgb(22, 22, 22))
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
    includeFontPadding = false
  }
  private val artistView = TextView(context).apply {
    textSize = 12f
    setTextColor(Color.argb(172, 22, 22, 22))
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
    includeFontPadding = false
  }
  private val progressView = DesktopMusicProgressView(context)
  private val playPauseButton = controlButton(">", "toggle_play")
  private val viewToggleButton = controlButton("FM", "toggle_view")
  private val radioMetaView = TextView(context).apply {
    textSize = 12f
    setTextColor(Color.argb(168, 22, 22, 22))
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
    includeFontPadding = false
  }
  private val radioStatusView = TextView(context).apply {
    textSize = 13f
    setTextColor(Color.rgb(22, 22, 22))
    maxLines = 2
    ellipsize = TextUtils.TruncateAt.END
    includeFontPadding = false
    setLineSpacing(dp(2).toFloat(), 1.0f)
  }
  private val radioScriptView = TextView(context).apply {
    textSize = 14f
    setTextColor(Color.argb(214, 22, 22, 22))
    includeFontPadding = false
    setLineSpacing(dp(3).toFloat(), 1.0f)
  }
  private val radioActionButton = controlButton("开台", "radio_action").apply {
    textSize = 13f
  }
  private val radioBackButton = controlButton("歌词", "toggle_view").apply {
    textSize = 13f
  }
  private val radioScriptScroll = ScrollView(context).apply {
    isVerticalScrollBarEnabled = true
    overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
    setPadding(0, dp(6), 0, 0)
    setOnTouchListener { view, event ->
      view.parent?.requestDisallowInterceptTouchEvent(event.actionMasked != MotionEvent.ACTION_UP)
      false
    }
    addView(radioScriptView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
  }
  private val radioButtonRow = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER
  }
  private val root = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER
  }
  private lateinit var infoRow: LinearLayout
  private lateinit var controlsRow: LinearLayout
  private val radioContent = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    visibility = View.GONE
    setPadding(0, dp(6), 0, 0)
  }
  private val expandedContent = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    visibility = View.GONE
  }
  private var isExpanded = false
  private var panelMode = "lyrics"
  private var lastArtworkUrl = ""
  private var lastBackgroundUri = ""
  private val clipPath = Path()
  private val clipRect = RectF()

  init {
    isClickable = true
    setWillNotDraw(false)
    clipToOutline = true
    outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {
        outline.setRoundRect(0, 0, view.width, view.height, dp(18).toFloat())
      }
    }
    background = roundedDrawable(Color.TRANSPARENT, dp(18), Color.TRANSPARENT)

    addView(backgroundView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

    addView(root, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    root.addView(lyricText, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))

    infoRow = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(0, dp(12), 0, 0)
    }
    infoRow.addView(coverView, LinearLayout.LayoutParams(dp(56), dp(56)))

    val infoColumn = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(12), 0, 0, 0)
    }
    infoColumn.addView(titleView, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, dp(22)))
    infoColumn.addView(artistView, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, dp(20)))
    infoColumn.addView(progressView, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, dp(18)).apply {
      topMargin = dp(6)
    })
    infoRow.addView(infoColumn, LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))

    controlsRow = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      setPadding(0, dp(12), 0, 0)
      addView(viewToggleButton, LinearLayout.LayoutParams(dp(42), dp(36)).apply {
        rightMargin = dp(8)
      })
      addView(controlButton("|<", "previous"), LinearLayout.LayoutParams(dp(42), dp(36)))
      addView(playPauseButton, LinearLayout.LayoutParams(dp(48), dp(36)).apply {
        leftMargin = dp(8)
        rightMargin = dp(8)
      })
      addView(controlButton(">|", "next"), LinearLayout.LayoutParams(dp(42), dp(36)))
      addView(controlButton("x", "close"), LinearLayout.LayoutParams(dp(42), dp(36)).apply {
        leftMargin = dp(14)
      })
    }

    radioButtonRow.addView(radioActionButton, LinearLayout.LayoutParams(dp(88), dp(32)).apply {
      rightMargin = dp(8)
    })
    radioButtonRow.addView(radioBackButton, LinearLayout.LayoutParams(dp(72), dp(32)))
    radioContent.addView(radioButtonRow, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, dp(32)))
    radioContent.addView(radioScriptScroll, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f).apply {
      topMargin = dp(8)
    })

    expandedContent.addView(infoRow, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    expandedContent.addView(radioContent, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
    expandedContent.addView(controlsRow, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    root.addView(expandedContent, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
    applyExpandedState()
  }

  fun update(
    lyric: String,
    lyricProgress: Float,
    title: String,
    artist: String,
    artworkUrl: String,
    songProgress: Float,
    isPlaying: Boolean,
    backgroundUri: String,
    nextPanelMode: String,
    radioStatus: String,
    radioScript: String,
    radioTrack: String,
    radioActionLabel: String,
    radioActionEnabled: Boolean,
    lyrics: List<DesktopLyricLine>,
    currentTimeMs: Long,
    durationMs: Long
  ) {
    panelMode = if (nextPanelMode == "radio") "radio" else "lyrics"
    val isRadioMode = panelMode == "radio"
    val radioHeader = listOf(radioTrack, radioStatus)
      .map { it.trim() }
      .filter { it.isNotBlank() }
      .joinToString("\n")
      .ifBlank { lyric }
    lyricText.textSize = if (isRadioMode) 14f else 17f
    if (isRadioMode || lyrics.isEmpty()) {
      lyricText.setLyricText(if (isRadioMode) radioHeader else lyric)
      lyricText.setLyricProgress(if (isRadioMode) 0f else lyricProgress)
    } else {
      lyricText.setPlaybackTimeline(lyrics, currentTimeMs, durationMs, isPlaying, lyric)
    }
    titleView.text = title
    artistView.text = if (isRadioMode) radioStatus else artist.ifBlank { "Unknown Artist" }
    progressView.setPlaybackState(currentTimeMs, durationMs, isPlaying, songProgress)
    playPauseButton.text = if (isPlaying) "II" else ">"
    viewToggleButton.text = if (isRadioMode) "Ly" else "FM"
    infoRow.visibility = if (isRadioMode) View.GONE else View.VISIBLE
    radioContent.visibility = if (isRadioMode && isExpanded) View.VISIBLE else View.GONE
    radioMetaView.text = radioTrack.ifBlank { "AI Radio" }
    radioStatusView.text = radioStatus.ifBlank { "AI 电台" }
    radioScriptView.text = radioScript.ifBlank { lyric }
    radioActionButton.text = radioActionLabel.ifBlank { "开台" }
    radioActionButton.isEnabled = radioActionEnabled
    radioActionButton.alpha = if (radioActionEnabled) 1f else 0.52f
    radioBackButton.alpha = 1f
    if (artworkUrl != lastArtworkUrl) {
      lastArtworkUrl = artworkUrl
      if (artworkUrl.isBlank()) {
        coverView.setImageDrawable(null)
      } else {
        Glide.with(context).load(artworkUrl).into(coverView)
      }
    }
    if (backgroundUri.isBlank()) {
      lastBackgroundUri = ""
      backgroundView.visibility = View.GONE
      backgroundView.setImageDrawable(null)
      backgroundView.background = null
      backgroundView.clearColorFilter()
    } else {
      backgroundView.visibility = View.VISIBLE
      backgroundView.background = null
      backgroundView.clearColorFilter()
      backgroundView.alpha = 1f
      if (backgroundUri != lastBackgroundUri) {
        lastBackgroundUri = backgroundUri
        Glide.with(context).load(backgroundUri).into(backgroundView)
      }
    }
    applyExpandedState()
  }

  fun toggleExpanded() {
    isExpanded = !isExpanded
    expandedContent.visibility = if (isExpanded) View.VISIBLE else View.GONE
    applyExpandedState()
    requestLayout()
  }

  private fun applyExpandedState() {
    val isRadioMode = panelMode == "radio"
    lyricText.maxLines = if (isRadioMode) {
      2
    } else {
      if (isExpanded) 2 else 1
    }
    root.gravity = if (isExpanded) Gravity.CENTER_HORIZONTAL else Gravity.CENTER
    val verticalPadding = if (isExpanded) dp(10) else dp(6)
    setPadding(dp(14), verticalPadding, dp(14), verticalPadding)
    infoRow.visibility = if (isRadioMode) View.GONE else View.VISIBLE
    radioContent.visibility = if (isRadioMode && isExpanded) View.VISIBLE else View.GONE
    controlsRow.visibility = if (isRadioMode) View.GONE else View.VISIBLE
  }

  fun preferredHeight(): Int {
    return if (isExpanded) dp(186) else dp(48)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val exactWidth = MeasureSpec.getSize(widthMeasureSpec)
    val exactHeight = preferredHeight()
    super.onMeasure(
      MeasureSpec.makeMeasureSpec(exactWidth, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(exactHeight, MeasureSpec.EXACTLY)
    )
    setMeasuredDimension(exactWidth, exactHeight)
  }

  override fun dispatchDraw(canvas: Canvas) {
    val radius = dp(18).toFloat()
    clipRect.set(0f, 0f, width.toFloat(), height.toFloat())
    clipPath.reset()
    clipPath.addRoundRect(clipRect, radius, radius, Path.Direction.CW)
    val saveCount = canvas.save()
    canvas.clipPath(clipPath)
    super.dispatchDraw(canvas)
    canvas.restoreToCount(saveCount)
  }

  override fun draw(canvas: Canvas) {
    val radius = dp(18).toFloat()
    clipRect.set(0f, 0f, width.toFloat(), height.toFloat())
    clipPath.reset()
    clipPath.addRoundRect(clipRect, radius, radius, Path.Direction.CW)
    val saveCount = canvas.save()
    canvas.clipPath(clipPath)
    super.draw(canvas)
    canvas.restoreToCount(saveCount)
  }

  private fun controlButton(label: String, action: String): TextView {
    return TextView(context).apply {
      text = label
      textSize = if (label == "x") 17f else 15f
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      setTextColor(Color.rgb(20, 20, 20))
      gravity = Gravity.CENTER
      includeFontPadding = false
      background = roundedDrawable(Color.argb(96, 255, 255, 255), dp(18))
      setOnClickListener { onAction(action) }
    }
  }

  private fun roundedDrawable(color: Int, radius: Int, strokeColor: Int = Color.argb(92, 255, 255, 255)): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      cornerRadius = radius.toFloat()
      setColor(color)
      setStroke(dp(1), strokeColor)
    }
  }

  private fun dp(value: Int): Int {
    return (value * resources.displayMetrics.density).toInt()
  }
}

private class RoundedImageView(
  context: Context,
  private val radiusProvider: () -> Float
) : ImageView(context) {
  private val clipPath = Path()
  private val clipRect = RectF()

  override fun draw(canvas: Canvas) {
    clipRect.set(0f, 0f, width.toFloat(), height.toFloat())
    clipPath.reset()
    val radius = radiusProvider()
    clipPath.addRoundRect(clipRect, radius, radius, Path.Direction.CW)
    val saveCount = canvas.save()
    canvas.clipPath(clipPath)
    super.draw(canvas)
    canvas.restoreToCount(saveCount)
  }
}


private class DesktopMusicProgressView(context: Context) : View(context) {
  private val trackPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(82, 255, 255, 255)
  }
  private val fillPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(20, 20, 20)
  }
  private var progress = 0f
  private var basePositionMs = 0L
  private var baseElapsedMs = 0L
  private var durationMs = 0L
  private var isPlaying = false
  private val clockRunnable = object : Runnable {
    override fun run() {
      refreshPlaybackProgress()
      scheduleClock()
    }
  }

  fun setProgress(nextProgress: Float) {
    stopClock()
    val boundedProgress = nextProgress.coerceIn(0f, 1f)
    if (abs(progress - boundedProgress) < 0.001f) return
    progress = boundedProgress
    invalidate()
  }

  fun setPlaybackState(
    currentTimeMs: Long,
    nextDurationMs: Long,
    nextIsPlaying: Boolean,
    fallbackProgress: Float
  ) {
    durationMs = nextDurationMs.coerceAtLeast(0L)
    if (durationMs <= 0L) {
      setProgress(fallbackProgress)
      return
    }

    basePositionMs = currentTimeMs.coerceIn(0L, durationMs)
    baseElapsedMs = SystemClock.elapsedRealtime()
    isPlaying = nextIsPlaying
    refreshPlaybackProgress()
    if (isPlaying) {
      scheduleClock()
    } else {
      stopClock()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (isPlaying) scheduleClock()
  }

  override fun onDetachedFromWindow() {
    stopClock()
    super.onDetachedFromWindow()
  }

  private fun scheduleClock() {
    if (!isAttachedToWindow || !isPlaying || durationMs <= 0L) return
    removeCallbacks(clockRunnable)
    postOnAnimation(clockRunnable)
  }

  private fun stopClock() {
    removeCallbacks(clockRunnable)
  }

  private fun refreshPlaybackProgress() {
    val elapsedMs = if (isPlaying) SystemClock.elapsedRealtime() - baseElapsedMs else 0L
    val currentMs = (basePositionMs + elapsedMs).coerceIn(0L, durationMs)
    val nextProgress = if (durationMs > 0L) currentMs.toFloat() / durationMs.toFloat() else 0f
    val boundedProgress = nextProgress.coerceIn(0f, 1f)
    if (abs(progress - boundedProgress) < 0.001f) return
    progress = boundedProgress
    postInvalidateOnAnimation()
  }

  override fun onDraw(canvas: android.graphics.Canvas) {
    super.onDraw(canvas)
    val centerY = height / 2f
    val barHeight = 4f * resources.displayMetrics.density
    val radius = barHeight / 2f
    canvas.drawRoundRect(0f, centerY - radius, width.toFloat(), centerY + radius, radius, radius, trackPaint)
    canvas.drawRoundRect(0f, centerY - radius, width * progress, centerY + radius, radius, radius, fillPaint)
  }
}

private class DesktopLyricTextView(context: Context) : TextView(context) {
  private val fadeWidth = 18f * resources.displayMetrics.density
  private var lyricProgress = 0f
  private var displayedLyric = ""
  private var progressAnimator: ValueAnimator? = null
  private var timelineLines: List<DesktopLyricLine> = emptyList()
  private var timelineSignature = ""
  private var timelineBasePositionMs = 0L
  private var timelineBaseElapsedMs = 0L
  private var timelineDurationMs = 0L
  private var timelineIsPlaying = false
  private var timelineFallbackText = ""
  private val timelineRunnable = object : Runnable {
    override fun run() {
      applyTimelineFrame()
      scheduleTimelineTick()
    }
  }

  fun setLyricText(nextText: String) {
    stopTimelineTick()
    timelineLines = emptyList()
    timelineSignature = ""
    timelineIsPlaying = false
    if (displayedLyric == nextText) return
    displayedLyric = nextText
    progressAnimator?.cancel()
    progressAnimator = null
    lyricProgress = 0f
    text = nextText
    invalidate()
  }

  fun setLyricProgress(progress: Float) {
    val nextProgress = progress.coerceIn(0f, 1f)
    if (abs(lyricProgress - nextProgress) < 0.001f) return
    progressAnimator?.cancel()
    progressAnimator = ValueAnimator.ofFloat(lyricProgress, nextProgress).apply {
      duration = PROGRESS_ANIMATION_MS
      interpolator = android.view.animation.LinearInterpolator()
      addUpdateListener { animator ->
        lyricProgress = animator.animatedValue as Float
        invalidate()
      }
      start()
    }
  }

  fun setPlaybackTimeline(
    lines: List<DesktopLyricLine>,
    currentTimeMs: Long,
    durationMs: Long,
    isPlaying: Boolean,
    fallbackText: String
  ) {
    val nextLines = lines.filter { it.text.isNotBlank() }.sortedBy { it.timeMs }
    if (nextLines.isEmpty()) {
      setLyricText(fallbackText)
      setLyricProgress(0f)
      return
    }

    val nextSignature = buildTimelineSignature(nextLines, fallbackText)
    val timelineChanged = nextSignature != timelineSignature
    timelineLines = nextLines
    timelineSignature = nextSignature
    timelineFallbackText = fallbackText
    timelineDurationMs = durationMs.coerceAtLeast(0L)
    val upperBoundMs = if (timelineDurationMs > 0L) timelineDurationMs else Long.MAX_VALUE
    timelineBasePositionMs = currentTimeMs.coerceIn(0L, upperBoundMs)
    timelineBaseElapsedMs = SystemClock.elapsedRealtime()
    timelineIsPlaying = isPlaying
    progressAnimator?.cancel()
    progressAnimator = null

    applyTimelineFrame(forceText = timelineChanged)
    if (timelineIsPlaying) {
      scheduleTimelineTick()
    } else {
      stopTimelineTick()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (timelineIsPlaying && timelineLines.isNotEmpty()) {
      scheduleTimelineTick()
    }
  }

  override fun onDetachedFromWindow() {
    stopTimelineTick()
    progressAnimator?.cancel()
    progressAnimator = null
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    invalidate()
  }

  override fun onDraw(canvas: android.graphics.Canvas) {
    paint.shader = null
    paint.color = Color.WHITE
    super.onDraw(canvas)

    if (width <= 0 || lyricProgress <= 0f) return

    val playedWidth = width * lyricProgress
    val saveCount = canvas.save()
    canvas.clipRect(0f, 0f, playedWidth, height.toFloat())
    paint.shader = playedTextShader(playedWidth)
    paint.color = PLAYED_TEXT_COLOR
    super.onDraw(canvas)
    paint.shader = null
    canvas.restoreToCount(saveCount)
  }

  private fun playedTextShader(playedWidth: Float): LinearGradient? {
    if (playedWidth >= width - 1f) return null
    if (playedWidth <= fadeWidth) {
      return LinearGradient(
        0f,
        0f,
        playedWidth.coerceAtLeast(1f),
        0f,
        intArrayOf(PLAYED_TEXT_COLOR, Color.WHITE),
        floatArrayOf(0f, 1f),
        Shader.TileMode.CLAMP
      )
    }

    return LinearGradient(
      0f,
      0f,
      playedWidth,
      0f,
      intArrayOf(PLAYED_TEXT_COLOR, PLAYED_TEXT_COLOR, Color.WHITE),
      floatArrayOf(0f, ((playedWidth - fadeWidth) / playedWidth).coerceIn(0f, 1f), 1f),
      Shader.TileMode.CLAMP
    )
  }

  private fun scheduleTimelineTick() {
    if (!isAttachedToWindow || !timelineIsPlaying || timelineLines.isEmpty()) return
    removeCallbacks(timelineRunnable)
    postOnAnimation(timelineRunnable)
  }

  private fun stopTimelineTick() {
    removeCallbacks(timelineRunnable)
  }

  private fun applyTimelineFrame(forceText: Boolean = false) {
    if (timelineLines.isEmpty()) return
    val positionMs = currentTimelinePositionMs()
    val lineIndex = currentTimelineLineIndex(positionMs)
    val currentLine = timelineLines.getOrNull(lineIndex)
    val nextLine = timelineLines.getOrNull(lineIndex + 1)
    val nextText = currentLine?.text ?: timelineFallbackText
    if (forceText || displayedLyric != nextText) {
      displayedLyric = nextText
      text = nextText
    }

    lyricProgress = if (currentLine == null) {
      boundedProgress(positionMs, 0L, timelineDurationMs)
    } else {
      val endMs = when {
        currentLine.durationMs > 0L -> currentLine.timeMs + currentLine.durationMs
        nextLine != null -> nextLine.timeMs
        timelineDurationMs > currentLine.timeMs -> timelineDurationMs
        else -> currentLine.timeMs + DEFAULT_LINE_DURATION_MS
      }
      boundedProgress(positionMs, currentLine.timeMs, endMs)
    }
    postInvalidateOnAnimation()
  }

  private fun currentTimelinePositionMs(): Long {
    val elapsedMs = if (timelineIsPlaying) SystemClock.elapsedRealtime() - timelineBaseElapsedMs else 0L
    val currentMs = timelineBasePositionMs + elapsedMs
    return if (timelineDurationMs > 0L) {
      currentMs.coerceIn(0L, timelineDurationMs)
    } else {
      currentMs.coerceAtLeast(0L)
    }
  }

  private fun currentTimelineLineIndex(positionMs: Long): Int {
    var index = -1
    for (lineIndex in timelineLines.indices) {
      if (timelineLines[lineIndex].timeMs <= positionMs) {
        index = lineIndex
      } else {
        break
      }
    }
    return index
  }

  private fun boundedProgress(positionMs: Long, startMs: Long, endMs: Long): Float {
    val durationMs = (endMs - startMs).coerceAtLeast(1L)
    return ((positionMs - startMs).toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)
  }

  private fun buildTimelineSignature(lines: List<DesktopLyricLine>, fallbackText: String): String {
    val first = lines.firstOrNull()
    val last = lines.lastOrNull()
    return "${lines.size}:${first?.timeMs ?: 0}:${last?.timeMs ?: 0}:${last?.text.orEmpty()}:$fallbackText"
  }

  companion object {
    private val PLAYED_TEXT_COLOR = Color.rgb(0, 128, 245)
    private const val PROGRESS_ANIMATION_MS = 180L
    private const val DEFAULT_LINE_DURATION_MS = 4000L
  }
}

class FloatingBallForegroundService : Service() {
  override fun onBind(intent: Intent?) = null

  override fun onCreate() {
    super.onCreate()
    running = true
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForegroundNotification()
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  private fun startForegroundNotification() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "悬浮球",
        NotificationManager.IMPORTANCE_DEFAULT
      ).apply {
        setShowBadge(false)
      }
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.createNotificationChannel(channel)
    }

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("YSClaude 悬浮球运行中")
      .setContentText("点开悬浮球可快速输入、截图和获取回复")
      .setOngoing(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  companion object {
    private const val CHANNEL_ID = "ysclaude-floating-overlay-priority"
    private const val NOTIFICATION_ID = 7205
    private const val START_RETRY_INTERVAL_MS = 30_000L
    @Volatile private var running = false
    @Volatile private var lastStartFailureAtMs = 0L

    fun start(context: Context) {
      val now = System.currentTimeMillis()
      if (running || now - lastStartFailureAtMs < START_RETRY_INTERVAL_MS) return
      val intent = Intent(context, FloatingBallForegroundService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (_: Exception) {
        lastStartFailureAtMs = now
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, FloatingBallForegroundService::class.java))
    }
  }
}

class ScreenCaptureService : Service() {
  override fun onBind(intent: Intent?) = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForegroundNotification()

    val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
      ?: Activity.RESULT_CANCELED
    val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent?.getParcelableExtra(EXTRA_DATA)
    }

    val promise = pendingPromise
    if (resultCode != Activity.RESULT_OK || data == null || promise == null) {
      resolvePending(null)
      stopSelf()
      return START_NOT_STICKY
    }

    Handler(Looper.getMainLooper()).post {
      captureOnce(resultCode, data, promise)
    }
    return START_NOT_STICKY
  }

  private fun captureOnce(resultCode: Int, data: Intent, promise: Promise) {
    var projection: MediaProjection? = null
    var projectionCallback: MediaProjection.Callback? = null
    var reader: ImageReader? = null
    var display: android.hardware.display.VirtualDisplay? = null

    try {
      val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      val activeProjection = projectionManager.getMediaProjection(resultCode, data)
        ?: throw IllegalStateException("MediaProjection is not available")
      projection = activeProjection
      projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
          cleanup(projection, display, reader, this)
        }
      }
      activeProjection.registerCallback(projectionCallback, Handler(Looper.getMainLooper()))
      val metrics = resources.displayMetrics
      val width = metrics.widthPixels
      val height = metrics.heightPixels
      val density = metrics.densityDpi
      reader = ImageReader.newInstance(width, height, android.graphics.PixelFormat.RGBA_8888, 2)
      display = activeProjection.createVirtualDisplay(
        "YSClaudeScreenCapture",
        width,
        height,
        density,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
        reader.surface,
        null,
        null
      )

      tryReadFrame(
        reader = reader,
        width = width,
        height = height,
        attempt = 0,
        promise = promise,
        projection = projection,
        display = display,
        callback = projectionCallback
      )
    } catch (error: Exception) {
      promise.reject("CAPTURE_SCREEN_FAILED", error)
      cleanup(projection, display, reader, projectionCallback)
      stopSelf()
    }
  }

  private fun tryReadFrame(
    reader: ImageReader,
    width: Int,
    height: Int,
    attempt: Int,
    promise: Promise,
    projection: MediaProjection?,
    display: android.hardware.display.VirtualDisplay?,
    callback: MediaProjection.Callback?
  ) {
    Handler(Looper.getMainLooper()).postDelayed({
      var cropped: Bitmap? = null
      try {
        val image = reader.acquireLatestImage()
        if (image == null) {
          retryOrFinish(reader, width, height, attempt, promise, projection, display, callback)
          return@postDelayed
        }

        image.use { frame ->
          val plane = frame.planes[0]
          val buffer = plane.buffer
          val pixelStride = plane.pixelStride
          val rowStride = plane.rowStride
          val rowPadding = rowStride - pixelStride * width
          val bitmap = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888)
          bitmap.copyPixelsFromBuffer(buffer)
          cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height)
          bitmap.recycle()
        }

        val frameBitmap = cropped
        if (frameBitmap == null || (attempt < MAX_CAPTURE_ATTEMPTS - 1 && isMostlyBlack(frameBitmap))) {
          frameBitmap?.recycle()
          retryOrFinish(reader, width, height, attempt, promise, projection, display, callback)
          return@postDelayed
        }

        val file = File(cacheDir, "floating-screen-${System.currentTimeMillis()}.png")
        FileOutputStream(file).use { out ->
          frameBitmap.compress(Bitmap.CompressFormat.PNG, 92, out)
        }
        frameBitmap.recycle()
        promise.resolve(Uri.fromFile(file).toString())
        cleanup(projection, display, reader, callback)
        stopSelf()
      } catch (error: Exception) {
        cropped?.recycle()
        promise.reject("CAPTURE_SCREEN_FAILED", error)
        cleanup(projection, display, reader, callback)
        stopSelf()
      }
    }, if (attempt == 0) 700 else 180)
  }

  private fun retryOrFinish(
    reader: ImageReader,
    width: Int,
    height: Int,
    attempt: Int,
    promise: Promise,
    projection: MediaProjection?,
    display: android.hardware.display.VirtualDisplay?,
    callback: MediaProjection.Callback?
  ) {
    if (attempt + 1 < MAX_CAPTURE_ATTEMPTS) {
      tryReadFrame(reader, width, height, attempt + 1, promise, projection, display, callback)
      return
    }
    promise.resolve(null)
    cleanup(projection, display, reader, callback)
    stopSelf()
  }

  private fun isMostlyBlack(bitmap: Bitmap): Boolean {
    val sampleStepX = (bitmap.width / 12).coerceAtLeast(1)
    val sampleStepY = (bitmap.height / 12).coerceAtLeast(1)
    var darkCount = 0
    var total = 0
    var y = sampleStepY / 2
    while (y < bitmap.height) {
      var x = sampleStepX / 2
      while (x < bitmap.width) {
        val pixel = bitmap.getPixel(x, y)
        val r = Color.red(pixel)
        val g = Color.green(pixel)
        val b = Color.blue(pixel)
        if (r + g + b < 36) darkCount++
        total++
        x += sampleStepX
      }
      y += sampleStepY
    }
    return total > 0 && darkCount.toFloat() / total.toFloat() > 0.96f
  }

  private fun cleanup(
    projection: MediaProjection?,
    display: android.hardware.display.VirtualDisplay?,
    reader: ImageReader?,
    callback: MediaProjection.Callback?
  ) {
    runCatching { display?.release() }
    runCatching { reader?.close() }
    runCatching {
      if (projection != null && callback != null) {
        projection.unregisterCallback(callback)
      }
    }
    runCatching { projection?.stop() }
    resolvePending(null)
  }

  private fun startForegroundNotification() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "屏幕共享",
        NotificationManager.IMPORTANCE_LOW
      )
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.createNotificationChannel(channel)
    }

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("YSClaude 正在截屏")
      .setContentText("用于发送当前屏幕到聊天")
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  companion object {
    private const val CHANNEL_ID = "ysclaude-screen-capture"
    private const val NOTIFICATION_ID = 7204
    private const val MAX_CAPTURE_ATTEMPTS = 9
    private const val EXTRA_RESULT_CODE = "resultCode"
    private const val EXTRA_DATA = "data"
    private var pendingPromise: Promise? = null

    fun hasPendingCapture(): Boolean = pendingPromise != null

    fun setPendingPromise(promise: Promise) {
      pendingPromise = promise
    }

    fun clearPendingPromise() {
      pendingPromise = null
    }

    fun capture(context: Context, resultCode: Int, data: Intent) {
      val intent = Intent(context, ScreenCaptureService::class.java).apply {
        putExtra(EXTRA_RESULT_CODE, resultCode)
        putExtra(EXTRA_DATA, data)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun resolvePending(value: String?) {
      if (value != null) {
        pendingPromise?.resolve(value)
      }
      pendingPromise = null
    }
  }
}
