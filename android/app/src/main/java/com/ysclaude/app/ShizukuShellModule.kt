package com.ysclaude.app

import android.content.ComponentName
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.Uri
import android.os.IBinder
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import rikka.shizuku.Shizuku
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.io.File
import java.util.concurrent.atomic.AtomicReference

class ShizukuShellModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "ShizukuShell"
  @Volatile private var service: IShizukuShellService? = null
  @Volatile private var previousInputMethod: String? = null
  private val args = Shizuku.UserServiceArgs(ComponentName(context, ShizukuShellUserService::class.java))
    .tag("ysclaude_shell_service")
    .daemon(false).processNameSuffix("shell").debuggable(BuildConfig.DEBUG).version(2)

  @ReactMethod fun status(promise: Promise) {
    val alive = Shizuku.pingBinder()
    promise.resolve(Arguments.createMap().apply {
      putBoolean("installed", alive)
      putBoolean("permissionGranted", alive && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED)
      putInt("uid", if (alive) Shizuku.getUid() else -1)
    })
  }

  @ReactMethod fun requestPermission(promise: Promise) {
    if (!Shizuku.pingBinder()) return promise.reject("SHIZUKU_UNAVAILABLE", "Shizuku 未运行")
    if (Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) return promise.resolve(true)
    val code = 4107
    lateinit var listener: Shizuku.OnRequestPermissionResultListener
    listener = Shizuku.OnRequestPermissionResultListener { requestCode, result ->
      if (requestCode == code) {
        Shizuku.removeRequestPermissionResultListener(listener)
        promise.resolve(result == PackageManager.PERMISSION_GRANTED)
      }
    }
    Shizuku.addRequestPermissionResultListener(listener)
    Shizuku.requestPermission(code)
  }

  @ReactMethod fun openManager(promise: Promise) {
    try {
      val packageName = "moe.shizuku.privileged.api"
      val intent = context.packageManager.getLaunchIntentForPackage(packageName)
        ?: android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
      intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("SHIZUKU_OPEN_MANAGER_FAILED", "无法打开 Shizuku，请确认已安装", error)
    }
  }

  @ReactMethod fun execute(command: String, timeoutMs: Double, maxOutputChars: Double, promise: Promise) {
    Thread {
      try {
        require(command.isNotBlank()) { "命令不能为空" }
        check(Shizuku.pingBinder()) { "Shizuku 未运行" }
        check(Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) { "尚未授权 Shizuku" }
        promise.resolve(Arguments.fromBundle(connect().execute(command, timeoutMs.toLong(), maxOutputChars.toInt())))
      } catch (error: Exception) { promise.reject("SHIZUKU_EXECUTE_FAILED", error) }
    }.start()
  }

  @ReactMethod fun captureScreen(promise: Promise) {
    Thread {
      try {
        check(Shizuku.pingBinder()) { "Shizuku is not running" }
        check(Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) { "Shizuku permission is not granted" }
        val directory = context.externalCacheDir ?: context.cacheDir
        directory.mkdirs()
        val file = File(directory, "shizuku-screen-${System.currentTimeMillis()}.png")
        val safePath = "'${file.absolutePath.replace("'", "'\\''")}'"
        val result = connect().execute("screencap -p $safePath && chmod 644 $safePath", 15000, 4000)
        check(result.getInt("exitCode", -1) == 0 && file.exists()) { result.getString("stderr") ?: "Shizuku screenshot failed" }
        promise.resolve("file://${file.absolutePath}")
      } catch (error: Exception) { promise.reject("SHIZUKU_SCREENSHOT_FAILED", error) }
    }.start()
  }

  @ReactMethod fun isInputMethodReady(promise: Promise) { promise.resolve(YSClaudeInputMethodService.isReady()) }
  @ReactMethod fun activateInputMethod(promise: Promise) {
    Thread {
      try {
        val shell = connect()
        val current = shell.execute("settings get secure default_input_method", 5000, 2000).getString("stdout")?.trim()
        val component = "${context.packageName}/.YSClaudeInputMethodService"
        if (!current.isNullOrBlank() && current != component) previousInputMethod = current
        val result = shell.execute("ime enable '$component' >/dev/null && ime set '$component'", 10000, 4000)
        check(result.getInt("exitCode", -1) == 0) { result.getString("stderr") ?: "Unable to activate YSClaude IME" }
        promise.resolve(true)
      } catch (error: Exception) { promise.reject("SHIZUKU_IME_ACTIVATE_FAILED", error) }
    }.start()
  }
  @ReactMethod fun restoreInputMethod(promise: Promise) {
    Thread {
      try {
        val previous = previousInputMethod
        if (!previous.isNullOrBlank()) connect().execute("ime set '${previous.replace("'", "'\\''")}'", 10000, 4000)
        promise.resolve(true)
      } catch (error: Exception) { promise.reject("SHIZUKU_IME_RESTORE_FAILED", error) }
    }.start()
  }
  @ReactMethod fun commitInputMethodText(text: String, promise: Promise) {
    val (success, message) = YSClaudeInputMethodService.commitText(text)
    promise.resolve(Arguments.createMap().apply { putBoolean("success", success); putString("message", message) })
  }
  @ReactMethod fun performInputMethodAction(action: String, promise: Promise) {
    val (success, message) = YSClaudeInputMethodService.performEditorAction(action)
    promise.resolve(Arguments.createMap().apply { putBoolean("success", success); putString("message", message) })
  }
  @ReactMethod fun deleteInputMethodText(beforeLength: Double, afterLength: Double, promise: Promise) {
    val (success, message) = YSClaudeInputMethodService.deleteSurroundingText(beforeLength.toInt(), afterLength.toInt())
    promise.resolve(Arguments.createMap().apply { putBoolean("success", success); putString("message", message) })
  }

  @Synchronized private fun connect(): IShizukuShellService {
    service?.takeIf { it.asBinder().isBinderAlive }?.let { return it }
    service = null
    val latch = CountDownLatch(1)
    val failure = AtomicReference<String?>(null)
    val connection = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName, binder: IBinder) { service = IShizukuShellService.Stub.asInterface(binder); latch.countDown() }
      override fun onServiceDisconnected(name: ComponentName) { service = null; failure.set("Shizuku Shell 服务已断开"); latch.countDown() }
      override fun onBindingDied(name: ComponentName) { service = null; failure.set("Shizuku Shell 服务进程启动失败或已死亡"); latch.countDown() }
      override fun onNullBinding(name: ComponentName) { service = null; failure.set("Shizuku Shell 服务返回了空 Binder"); latch.countDown() }
    }
    try {
      Shizuku.bindUserService(args, connection)
    } catch (error: Exception) {
      throw IllegalStateException("启动 Shizuku Shell 服务失败: ${error.message}", error)
    }
    check(latch.await(15, TimeUnit.SECONDS)) { "连接 Shizuku Shell 服务超时，请在 Shizuku 中重新授权后重试" }
    failure.get()?.let { error(it) }
    return service?.takeIf { it.asBinder().isBinderAlive } ?: error("无法连接 Shizuku Shell 服务")
  }
}
