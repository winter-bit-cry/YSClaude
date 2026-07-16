package com.ysclaude.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

class AndroidFilePickerModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "AndroidFilePicker"

  private var pendingPromise: Promise? = null

  private val activityEventListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_PICK_READING_BOOK && requestCode != REQUEST_PICK_CONVERSATION_FILE) return
      val promise = pendingPromise ?: return
      pendingPromise = null

      if (resultCode != Activity.RESULT_OK) {
        promise.resolve(null)
        return
      }

      val uri = data?.data
      if (uri == null) {
        promise.reject("PICK_FILE_FAILED", "No file URI returned")
        return
      }
      promise.resolve(buildFileResult(uri))
    }
  }

  init {
    reactContext.addActivityEventListener(activityEventListener)
  }

  @ReactMethod
  fun pickReadingBook(promise: Promise) {
    openFileChooser(promise, "选择电子书来源", REQUEST_PICK_READING_BOOK)
  }

  @ReactMethod
  fun pickConversationFile(promise: Promise) {
    openFileChooser(promise, "选择聊天文件", REQUEST_PICK_CONVERSATION_FILE)
  }

  @ReactMethod
  fun readTextFile(uriValue: String, promise: Promise) {
    try {
      val bytes = reactContext.contentResolver.openInputStream(Uri.parse(uriValue))?.use { it.readBytes() }
        ?: throw IllegalStateException("Unable to open selected file")
      promise.resolve(decodeText(bytes))
    } catch (error: Exception) {
      promise.reject("READ_TEXT_FILE_FAILED", error)
    }
  }

  private fun openFileChooser(promise: Promise, title: String, requestCode: Int) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Current Android activity is not available")
      return
    }
    if (pendingPromise != null) {
      promise.reject("PICKER_BUSY", "A file picker is already open")
      return
    }

    pendingPromise = promise
    val openIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    try {
      activity.startActivityForResult(Intent.createChooser(openIntent, title), requestCode)
    } catch (error: Exception) {
      pendingPromise = null
      promise.reject("OPEN_PICKER_FAILED", error)
    }
  }

  private fun buildFileResult(uri: Uri): WritableNativeMap {
    val result = WritableNativeMap()
    val resolver = reactContext.contentResolver
    result.putString("uri", uri.toString())
    result.putString("mimeType", resolver.getType(uri))

    var name: String? = null
    var size: Double? = null
    try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
        ?.use { cursor ->
          if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0) name = cursor.getString(nameIndex)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex).toDouble()
          }
        }
    } catch (_: Exception) {
      // Metadata is best-effort.
    }

    result.putString("name", name ?: uri.lastPathSegment ?: "未命名文件")
    if (size != null) result.putDouble("size", size!!)
    return result
  }

  companion object {
    private const val REQUEST_PICK_READING_BOOK = 4108
    private const val REQUEST_PICK_CONVERSATION_FILE = 4109

    private fun decodeText(bytes: ByteArray): String {
      if (bytes.size >= 3 &&
        bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()
      ) return String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
      if (bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte()) {
        return String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
      }
      if (bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()) {
        return String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
      }

      decodeStrict(bytes, Charsets.UTF_8)?.let { return it }
      if (looksLikeUtf16(bytes, false)) decodeStrict(bytes, Charsets.UTF_16LE)?.let { return it }
      if (looksLikeUtf16(bytes, true)) decodeStrict(bytes, Charsets.UTF_16BE)?.let { return it }
      return String(bytes, Charset.forName("GB18030"))
    }

    private fun decodeStrict(bytes: ByteArray, charset: Charset): String? = try {
      charset.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes))
        .toString()
    } catch (_: CharacterCodingException) {
      null
    }

    private fun looksLikeUtf16(bytes: ByteArray, evenZeroBytes: Boolean): Boolean {
      if (bytes.size < 4) return false
      var zeroCount = 0
      var sampleCount = 0
      val limit = minOf(bytes.size, 4096)
      var index = if (evenZeroBytes) 0 else 1
      while (index < limit) {
        sampleCount += 1
        if (bytes[index] == 0.toByte()) zeroCount += 1
        index += 2
      }
      return sampleCount > 0 && zeroCount * 2 > sampleCount
    }
  }
}
