package com.ysclaude.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ContentValues
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import android.widget.RemoteViewsService.RemoteViewsFactory
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.max
import kotlin.math.min

private const val WIDGET_LARGE_MIN_HEIGHT_DP = 280
private const val WIDGET_MAX_SMALL_TODOS = 3
private const val WIDGET_MAX_LARGE_TODOS = 5

class TodayTodoWidgetProvider : AppWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_COMPLETE_TODO -> {
        completeTodoFromIntent(context, intent)
        return
      }
      ACTION_OPEN_CALENDAR -> {
        openCalendarFromWidget(context)
        return
      }
    }
    super.onReceive(context, intent)
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
    updateWidgets(context, manager, widgetIds)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    widgetId: Int,
    newOptions: Bundle
  ) {
    updateWidgets(context, manager, intArrayOf(widgetId))
  }

  companion object {
    private const val PREFS = "ysclaude_today_widget"
    private const val KEY_SNAPSHOT = "snapshot"
    private const val DATABASE_NAME = "ysclaude.db"
    private const val ACTION_COMPLETE_TODO = "com.ysclaude.app.widget.COMPLETE_TODO"
    private const val ACTION_OPEN_CALENDAR = "com.ysclaude.app.widget.OPEN_CALENDAR"
    private const val EXTRA_TODO_ID = "todo_id"
    private const val EXTRA_DATE_KEY = "date_key"

    fun saveSnapshot(context: Context, snapshot: JSONObject) {
      writeSnapshot(context, snapshot)

      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, TodayTodoWidgetProvider::class.java))
      updateWidgets(context, manager, ids, snapshot)
    }

    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, TodayTodoWidgetProvider::class.java))
      updateWidgets(context, manager, ids)
    }

    private fun updateWidgets(
      context: Context,
      manager: AppWidgetManager,
      widgetIds: IntArray,
      snapshotOverride: JSONObject? = null
    ) {
      if (widgetIds.isEmpty()) return
      val snapshot = snapshotOverride ?: readSnapshot(context)
      widgetIds.forEach { widgetId ->
        val options = manager.getAppWidgetOptions(widgetId)
        manager.updateAppWidget(widgetId, buildViews(context, snapshot, options))
      }
      manager.notifyAppWidgetViewDataChanged(widgetIds, R.id.widget_todo_list)
    }

    private fun buildViews(context: Context, snapshot: JSONObject, options: Bundle): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_today_todos)
      views.setOnClickPendingIntent(R.id.widget_root, openCalendarPendingIntent(context))
      views.setImageViewBitmap(R.id.widget_canvas, WidgetCardRenderer(context, snapshot, options).render())
      views.setRemoteAdapter(
        R.id.widget_todo_list,
        Intent(context, TodayTodoWidgetService::class.java).apply {
          data = Uri.parse("ysclaude://today-widget/todos/${snapshot.optLong("updatedAt", 0)}")
        }
      )
      views.setPendingIntentTemplate(R.id.widget_todo_list, widgetActionTemplatePendingIntent(context))
      return views
    }

    fun readSnapshot(context: Context): JSONObject {
      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_SNAPSHOT, null)
      if (raw.isNullOrBlank()) return defaultSnapshot()
      return runCatching { JSONObject(raw) }.getOrElse { defaultSnapshot() }
    }

    private fun defaultSnapshot(): JSONObject {
      return JSONObject()
        .put("displayName", "You")
        .put("handle", "ysclaude")
        .put("dateLabel", "Today")
        .put("quote", "One thing at a time.")
        .put("todos", JSONArray())
        .put("activeDays", 0)
        .put("todayMessages", 0)
        .put("todayTokens", 0)
    }

    private fun writeSnapshot(context: Context, snapshot: JSONObject) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_SNAPSHOT, snapshot.toString())
        .commit()
    }

    private fun openCalendarPendingIntent(context: Context): PendingIntent {
      val launchIntent = Intent(Intent.ACTION_VIEW, Uri.parse("ysclaude:///calendar")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      return PendingIntent.getActivity(
        context,
        7301,
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag()
      )
    }

    private fun widgetActionTemplatePendingIntent(context: Context): PendingIntent {
      val intent = Intent(context, TodayTodoWidgetProvider::class.java)
      return PendingIntent.getBroadcast(
        context,
        8100,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag()
      )
    }

    fun completeTodoFillInIntent(todoId: String, dateKey: String): Intent {
      return Intent().apply {
        action = ACTION_COMPLETE_TODO
        putExtra(EXTRA_TODO_ID, todoId)
        putExtra(EXTRA_DATE_KEY, dateKey)
      }
    }

    fun openCalendarFillInIntent(): Intent {
      return Intent().apply { action = ACTION_OPEN_CALENDAR }
    }

    private fun openCalendarFromWidget(context: Context) {
      val calendarIntent = Intent(Intent.ACTION_VIEW, Uri.parse("ysclaude:///calendar")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      val fallbackIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(context, MainActivity::class.java)
      fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      runCatching { context.startActivity(calendarIntent) }
        .getOrElse { context.startActivity(fallbackIntent) }
    }

    private fun completeTodoFromIntent(context: Context, intent: Intent) {
      val todoId = intent.getStringExtra(EXTRA_TODO_ID)?.trim().orEmpty()
      val dateKey = intent.getStringExtra(EXTRA_DATE_KEY)?.trim().orEmpty()
      if (todoId.isBlank() || dateKey.isBlank()) return

      val snapshot = readSnapshot(context)
      val updatedSnapshot = markTodoComplete(context, snapshot, todoId, dateKey)
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, TodayTodoWidgetProvider::class.java))
      updateWidgets(context, manager, ids, updatedSnapshot)
    }

    private fun markTodoComplete(
      context: Context,
      snapshot: JSONObject,
      todoId: String,
      dateKey: String
    ): JSONObject {
      val now = System.currentTimeMillis()
      val dbFile = File(context.filesDir, "SQLite/$DATABASE_NAME")
      if (!dbFile.exists()) return markSnapshotTodoDone(context, snapshot, todoId, now)

      return runCatching {
        SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
          val values = ContentValues().apply {
            put("completed_at", now)
            put("updated_at", now)
          }
          db.update(
            "calendar_todos",
            values,
            "id = ? AND (completed_at IS NULL OR completed_at = 0)",
            arrayOf(todoId)
          )
          snapshot.put("dateKey", dateKey)
          snapshot.put("updatedAt", now)
          snapshot.put("todos", readTodosForDate(db, dateKey))
        }
        writeSnapshot(context, snapshot)
        snapshot
      }.getOrElse {
        markSnapshotTodoDone(context, snapshot, todoId, now)
      }
    }

    private fun markSnapshotTodoDone(
      context: Context,
      snapshot: JSONObject,
      todoId: String,
      now: Long
    ): JSONObject {
      val todos = snapshot.optJSONArray("todos") ?: JSONArray()
      for (index in 0 until todos.length()) {
        val todo = todos.optJSONObject(index) ?: continue
        if (todo.optString("id") == todoId) {
          todo.put("done", true)
        }
      }
      snapshot.put("updatedAt", now)
      writeSnapshot(context, snapshot)
      return snapshot
    }

    private fun readTodosForDate(db: SQLiteDatabase, dateKey: String): JSONArray {
      val todos = JSONArray()
      db.rawQuery(
        """
          SELECT id, title, date_key, scheduled_time, completed_at
            FROM calendar_todos
           WHERE date_key = ?
           ORDER BY
             CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END ASC,
             CASE WHEN scheduled_time IS NULL OR scheduled_time = '' THEN 1 ELSE 0 END ASC,
             scheduled_time ASC,
             created_at ASC
        """.trimIndent(),
        arrayOf(dateKey)
      ).use { cursor ->
        val idIndex = cursor.getColumnIndexOrThrow("id")
        val titleIndex = cursor.getColumnIndexOrThrow("title")
        val dateIndex = cursor.getColumnIndexOrThrow("date_key")
        val timeIndex = cursor.getColumnIndexOrThrow("scheduled_time")
        val completedIndex = cursor.getColumnIndexOrThrow("completed_at")
        while (cursor.moveToNext()) {
          val scheduledTime = if (cursor.isNull(timeIndex)) "" else cursor.getString(timeIndex)
          todos.put(
            JSONObject()
              .put("id", cursor.getString(idIndex))
              .put("title", cursor.getString(titleIndex))
              .put("dateKey", cursor.getString(dateIndex))
              .put("scheduledTime", scheduledTime)
              .put("done", !cursor.isNull(completedIndex) && cursor.getLong(completedIndex) > 0)
          )
        }
      }
      return todos
    }

    fun textColor(context: Context): Int {
      return if (isNight(context)) Color.rgb(231, 233, 234) else Color.rgb(15, 20, 25)
    }

    fun mutedColor(context: Context): Int {
      return if (isNight(context)) Color.rgb(113, 118, 123) else Color.rgb(83, 100, 113)
    }

    private fun isNight(context: Context): Boolean {
      return (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    }

    private fun mutableFlag(): Int {
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    }

    private fun immutableFlag(): Int {
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    }
  }
}

class TodayTodoWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
    return TodayTodoWidgetFactory(applicationContext)
  }
}

private class TodayTodoWidgetFactory(
  private val context: Context
) : RemoteViewsService.RemoteViewsFactory {
  private var snapshot = JSONObject()
  private var todos = JSONArray()

  override fun onCreate() {
    load()
  }

  override fun onDataSetChanged() {
    load()
  }

  override fun onDestroy() = Unit

  override fun getCount(): Int = todos.length()

  override fun getViewAt(position: Int): RemoteViews {
    val item = todos.optJSONObject(position) ?: JSONObject()
    val done = item.optBoolean("done", false)
    val time = item.optString("scheduledTime", "").trim()
    val title = item.optString("title", "").trim()
    val text = if (time.isBlank()) title else "$time $title"
    val views = RemoteViews(context.packageName, R.layout.widget_today_todo_row)
    val rowTextColor = if (done) TodayTodoWidgetProvider.mutedColor(context) else TodayTodoWidgetProvider.textColor(context)
    val paintFlags = Paint.ANTI_ALIAS_FLAG or if (done) Paint.STRIKE_THRU_TEXT_FLAG else 0

    views.setTextViewText(R.id.widget_todo_text, text)
    views.setTextColor(R.id.widget_todo_text, rowTextColor)
    views.setInt(R.id.widget_todo_text, "setPaintFlags", paintFlags)
    views.setTextViewText(R.id.widget_todo_checkbox, if (done) "\u2713" else "")
    views.setTextColor(R.id.widget_todo_checkbox, Color.WHITE)
    views.setInt(
      R.id.widget_todo_checkbox,
      "setBackgroundResource",
      if (done) R.drawable.widget_checked_background else R.drawable.widget_unchecked_background
    )

    val todoId = item.optString("id", "").trim()
    val dateKey = snapshot.optString("dateKey", item.optString("dateKey", "")).trim()
    if (todoId.isNotBlank() && dateKey.isNotBlank() && !done) {
      views.setOnClickFillInIntent(
        R.id.widget_todo_checkbox,
        TodayTodoWidgetProvider.completeTodoFillInIntent(todoId, dateKey)
      )
    }
    views.setOnClickFillInIntent(
      R.id.widget_todo_text,
      TodayTodoWidgetProvider.openCalendarFillInIntent()
    )
    return views
  }

  override fun getLoadingView(): RemoteViews? = null
  override fun getViewTypeCount(): Int = 1
  override fun getItemId(position: Int): Long {
    return todos.optJSONObject(position)?.optString("id")?.hashCode()?.toLong() ?: position.toLong()
  }

  override fun hasStableIds(): Boolean = true

  private fun load() {
    snapshot = TodayTodoWidgetProvider.readSnapshot(context)
    todos = snapshot.optJSONArray("todos") ?: JSONArray()
  }
}

private class WidgetCardRenderer(
  private val context: Context,
  private val snapshot: JSONObject,
  options: Bundle
) {
  private val density = context.resources.displayMetrics.density
  private val scaledDensity = context.resources.displayMetrics.scaledDensity
  private val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
    Configuration.UI_MODE_NIGHT_YES
  private val widthDp = max(
    280,
    max(
      options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0),
      options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
    ).takeIf { it > 0 } ?: 360
  )
  private val heightDp = max(
    130,
    max(
      options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0),
      options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
    ).takeIf { it > 0 } ?: 205
  )
  private val large = heightDp >= WIDGET_LARGE_MIN_HEIGHT_DP
  private val width = dp(widthDp.toFloat())
  private val height = dp(heightDp.toFloat())
  private val cardBg = if (night) Color.BLACK else Color.WHITE
  private val textColor = if (night) Color.rgb(231, 233, 234) else Color.rgb(15, 20, 25)
  private val mutedColor = if (night) Color.rgb(113, 118, 123) else Color.rgb(83, 100, 113)
  private val borderColor = if (night) Color.rgb(47, 51, 54) else Color.rgb(239, 243, 244)
  private val accentColor = Color.rgb(29, 155, 240)
  private val likedColor = Color.rgb(249, 24, 128)

  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = textColor
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
  }

  fun render(): Bitmap {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
    drawCard(canvas)
    drawHeader(canvas)
    drawFooter(canvas)
    if ((snapshot.optJSONArray("todos") ?: JSONArray()).length() == 0) {
      drawEmptyTodos(canvas)
    }
    return bitmap
  }

  private fun drawCard(canvas: Canvas) {
    val rect = RectF(0f, 0f, width.toFloat(), height.toFloat())
    paint.style = Paint.Style.FILL
    paint.color = cardBg
    canvas.drawRoundRect(rect, dp(16f).toFloat(), dp(16f).toFloat(), paint)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = dp(1f).toFloat()
    paint.color = borderColor
    canvas.drawRoundRect(rect.insetCopy(dp(0.5f).toFloat()), dp(16f).toFloat(), dp(16f).toFloat(), paint)
    paint.style = Paint.Style.FILL
  }

  private fun drawHeader(canvas: Canvas) {
    val left = dp(16f).toFloat()
    val top = dp(14f).toFloat()
    val avatarSize = dp(40f).toFloat()
    val avatar = loadCircularAvatar(avatarSize.toInt())
    if (avatar != null) {
      canvas.drawBitmap(avatar, left, top, null)
    } else {
      drawFallbackAvatar(canvas, left, top, avatarSize)
    }

    val textLeft = left + avatarSize + dp(10f)
    val right = width - dp(16f).toFloat()
    drawMore(canvas, right - dp(10f), top + dp(12f))

    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    textPaint.textSize = sp(15f)
    textPaint.color = textColor
    val displayName = stringValue("displayName", "You")
    val nameMax = right - textLeft - dp(42f)
    val drawnName = drawEllipsized(canvas, displayName, textLeft, top + dp(16f), nameMax, textPaint)
    drawVerified(canvas, min(textLeft + drawnName + dp(7f), right - dp(34f)), top + dp(3f))

    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
    textPaint.textSize = sp(13f)
    textPaint.color = mutedColor
    val handle = "@${stringValue("handle", "ysclaude").trimStart('@')}"
    val date = "\u00b7 ${stringValue("dateLabel", "Today")}"
    drawEllipsized(canvas, "$handle $date", textLeft, top + dp(35f), right - textLeft - dp(20f), textPaint)
  }

  private fun drawTodos(canvas: Canvas, contentBottom: Float) {
    val todos = snapshot.optJSONArray("todos") ?: JSONArray()
    val maxRows = if (large) WIDGET_MAX_LARGE_TODOS else WIDGET_MAX_SMALL_TODOS
    val startY = dp(68f).toFloat()
    val rowHeight = dp(24f).toFloat()
    val count = min(todos.length(), maxRows)
    val left = dp(16f).toFloat()
    val textLeft = left + dp(26f)
    val right = width - dp(16f).toFloat()

    if (count == 0) {
      textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
      textPaint.textSize = sp(15f)
      textPaint.color = mutedColor
      drawEllipsized(canvas, "今天没有待办。", left, startY + dp(18f), right - left, textPaint)
      return
    }

    for (index in 0 until count) {
      val item = todos.optJSONObject(index) ?: JSONObject()
      val done = item.optBoolean("done", false)
      val time = item.optString("scheduledTime", "").trim()
      val title = item.optString("title", "").trim()
      val text = if (time.isBlank()) title else "$time $title"
      val y = startY + rowHeight * index
      drawCheckbox(canvas, left, y + dp(2f), done)
      textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
      textPaint.textSize = sp(15f)
      textPaint.color = if (done) mutedColor else textColor
      textPaint.isStrikeThruText = done
      drawEllipsized(canvas, text, textLeft, y + dp(16f), right - textLeft, textPaint)
      textPaint.isStrikeThruText = false
    }
  }

  private fun drawEmptyTodos(canvas: Canvas) {
    val left = dp(16f).toFloat()
    val right = width - dp(16f).toFloat()
    val startY = dp(68f).toFloat()
    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
    textPaint.textSize = sp(15f)
    textPaint.color = mutedColor
    drawEllipsized(canvas, "\u4eca\u5929\u6ca1\u6709\u5f85\u529e\u3002", left, startY + dp(18f), right - left, textPaint)
  }

  private fun drawLargeContent(canvas: Canvas, footerTop: Float): Float {
    val statsHeight = dp(36f).toFloat()
    val quoteHeight = dp(52f).toFloat()
    val statsTop = footerTop - statsHeight - dp(6f)
    val quoteTop = statsTop - quoteHeight - dp(6f)
    if (quoteTop < dp(190f)) return footerTop - dp(8f)

    val left = dp(16f).toFloat()
    val right = width - dp(16f).toFloat()
    val quoteRect = RectF(left, quoteTop, right, quoteTop + quoteHeight)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = dp(1f).toFloat()
    paint.color = borderColor
    canvas.drawRoundRect(quoteRect, dp(12f).toFloat(), dp(12f).toFloat(), paint)
    paint.style = Paint.Style.FILL

    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.ITALIC)
    textPaint.textSize = sp(14f)
    textPaint.color = textColor
    drawEllipsized(canvas, "\"${stringValue("quote", "One thing at a time.")}\"", left + dp(12f), quoteTop + dp(23f), right - left - dp(24f), textPaint)
    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
    textPaint.textSize = sp(12f)
    textPaint.color = mutedColor
    val author = "- ${stringValue("handle", "ysclaude").trimStart('@')}"
    val authorWidth = textPaint.measureText(author)
    canvas.drawText(author, right - dp(12f) - authorWidth, quoteTop + dp(42f), textPaint)

    paint.color = borderColor
    canvas.drawRect(left, statsTop, right, statsTop + dp(1f), paint)
    drawStat(canvas, "${snapshot.optInt("activeDays", 0)}", "天", left, statsTop + dp(22f), (right - left) / 3f)
    drawStat(canvas, "${snapshot.optInt("todayMessages", 0)}", "条消息", left + (right - left) / 3f, statsTop + dp(22f), (right - left) / 3f)
    drawStat(canvas, compactCount(snapshot.optLong("todayTokens", 0)), "tokens", left + (right - left) * 2f / 3f, statsTop + dp(22f), (right - left) / 3f)
    return quoteTop - dp(6f)
  }

  private fun drawFooter(canvas: Canvas): Float {
    val footerHeight = dp(40f).toFloat()
    val footerTop = height - footerHeight - dp(4f)
    val left = dp(16f).toFloat()
    val right = width - dp(16f).toFloat()
    paint.color = borderColor
    canvas.drawRect(left, footerTop, right, footerTop + dp(1f), paint)

    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
    textPaint.textSize = sp(13f)
    val labels = listOf("○ 520", "↻ 1314", "♥ 9999", "▤ 3.1万", "⌑", "⌯")
    val step = (right - left) / labels.size
    labels.forEachIndexed { index, label ->
      textPaint.color = if (index == 2) likedColor else mutedColor
      drawEllipsized(canvas, label, left + step * index, footerTop + dp(26f), step - dp(4f), textPaint)
    }
    return footerTop
  }

  private fun drawFallbackAvatar(canvas: Canvas, left: Float, top: Float, size: Float) {
    paint.shader = LinearGradient(left, top, left + size, top + size, Color.rgb(244, 164, 96), Color.rgb(232, 145, 90), Shader.TileMode.CLAMP)
    canvas.drawCircle(left + size / 2f, top + size / 2f, size / 2f, paint)
    paint.shader = null
    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    textPaint.textSize = sp(13f)
    textPaint.color = Color.WHITE
    val label = "YS"
    canvas.drawText(label, left + size / 2f - textPaint.measureText(label) / 2f, top + size / 2f - (textPaint.descent() + textPaint.ascent()) / 2f, textPaint)
  }

  private fun drawVerified(canvas: Canvas, left: Float, top: Float) {
    val radius = dp(9f).toFloat()
    paint.color = accentColor
    canvas.drawCircle(left + radius, top + radius, radius, paint)
    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    textPaint.textSize = sp(11f)
    textPaint.color = Color.WHITE
    canvas.drawText("\u2713", left + dp(5.3f), top + dp(12.8f), textPaint)
  }

  private fun drawMore(canvas: Canvas, x: Float, y: Float) {
    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    textPaint.textSize = sp(18f)
    textPaint.color = mutedColor
    canvas.drawText("\u22ef", x, y, textPaint)
  }

  private fun drawCheckbox(canvas: Canvas, left: Float, top: Float, done: Boolean) {
    val rect = RectF(left, top, left + dp(18f), top + dp(18f))
    if (done) {
      paint.style = Paint.Style.FILL
      paint.color = accentColor
      canvas.drawRoundRect(rect, dp(4f).toFloat(), dp(4f).toFloat(), paint)
      textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      textPaint.textSize = sp(12f)
      textPaint.color = Color.WHITE
      canvas.drawText("\u2713", left + dp(4.2f), top + dp(13f), textPaint)
      return
    }
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = dp(2f).toFloat()
    paint.color = mutedColor
    canvas.drawRoundRect(rect.insetCopy(dp(1f).toFloat()), dp(4f).toFloat(), dp(4f).toFloat(), paint)
    paint.style = Paint.Style.FILL
  }

  private fun drawStat(canvas: Canvas, number: String, label: String, left: Float, baseline: Float, width: Float) {
    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    textPaint.textSize = sp(15f)
    textPaint.color = textColor
    val numberWidth = drawEllipsized(canvas, number, left, baseline, width * 0.54f, textPaint)
    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
    textPaint.textSize = sp(12f)
    textPaint.color = mutedColor
    drawEllipsized(canvas, label, left + numberWidth + dp(4f), baseline, width - numberWidth - dp(6f), textPaint)
  }

  private fun drawEllipsized(canvas: Canvas, text: String, x: Float, baseline: Float, maxWidth: Float, paint: Paint): Float {
    if (maxWidth <= 0f) return 0f
    val clean = text.replace('\n', ' ').trim()
    if (paint.measureText(clean) <= maxWidth) {
      canvas.drawText(clean, x, baseline, paint)
      return paint.measureText(clean)
    }
    val ellipsis = "..."
    var end = clean.length
    while (end > 0 && paint.measureText(clean.substring(0, end) + ellipsis) > maxWidth) {
      end--
    }
    val next = if (end <= 0) ellipsis else clean.substring(0, end).trimEnd() + ellipsis
    canvas.drawText(next, x, baseline, paint)
    return paint.measureText(next)
  }

  private fun loadCircularAvatar(size: Int): Bitmap? {
    val rawUri = stringValue("avatarUri", "")
    if (rawUri.isBlank()) return null
    return runCatching {
      val uri = Uri.parse(rawUri)
      val source = if (uri.scheme == "file") {
        File(uri.path.orEmpty()).inputStream()
      } else {
        context.contentResolver.openInputStream(uri)
      } ?: return null
      source.use { input ->
        val decoded = BitmapFactory.decodeStream(input) ?: return null
        circularCrop(decoded, size)
      }
    }.getOrNull()
  }

  private fun circularCrop(source: Bitmap, size: Int): Bitmap {
    val edge = min(source.width, source.height)
    val left = (source.width - edge) / 2
    val top = (source.height - edge) / 2
    val src = Rect(left, top, left + edge, top + edge)
    val dst = RectF(0f, 0f, size.toFloat(), size.toFloat())
    val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val clip = Path().apply { addOval(dst, Path.Direction.CW) }
    canvas.clipPath(clip)
    canvas.drawBitmap(source, src, dst, Paint(Paint.ANTI_ALIAS_FLAG))
    if (source != output) source.recycle()
    return output
  }

  private fun stringValue(key: String, fallback: String): String {
    val value = snapshot.optString(key, fallback)
    if (value.isBlank() || value == "null") return fallback
    return value
  }

  private fun compactCount(value: Long): String {
    return when {
      value >= 1_000_000 -> "${value / 1_000_000}m"
      value >= 1_000 -> "${value / 1_000}k"
      else -> value.toString()
    }
  }

  private fun dp(value: Float): Int = (value * density + 0.5f).toInt()
  private fun sp(value: Float): Float = value * scaledDensity
}

private fun RectF.insetCopy(value: Float): RectF {
  return RectF(left + value, top + value, right - value, bottom - value)
}

class TodayTodoWidgetModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "TodayTodoWidget"

  @ReactMethod
  fun updateSnapshot(snapshot: ReadableMap, promise: Promise) {
    try {
      TodayTodoWidgetProvider.saveSnapshot(reactContext, readableMapToJson(snapshot))
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("UPDATE_TODAY_WIDGET_FAILED", error)
    }
  }

  @ReactMethod
  fun refresh(promise: Promise) {
    try {
      TodayTodoWidgetProvider.updateAll(reactContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("REFRESH_TODAY_WIDGET_FAILED", error)
    }
  }

  private fun readableMapToJson(map: ReadableMap): JSONObject {
    val json = JSONObject()
    val iterator = map.keySetIterator()
    while (iterator.hasNextKey()) {
      val key = iterator.nextKey()
      when (map.getType(key)) {
        ReadableType.Null -> json.put(key, JSONObject.NULL)
        ReadableType.Boolean -> json.put(key, map.getBoolean(key))
        ReadableType.Number -> json.put(key, map.getDouble(key))
        ReadableType.String -> json.put(key, map.getString(key))
        ReadableType.Map -> json.put(key, readableMapToJson(map.getMap(key)!!))
        ReadableType.Array -> json.put(key, readableArrayToJson(map.getArray(key)!!))
      }
    }
    return json
  }

  private fun readableArrayToJson(array: ReadableArray): JSONArray {
    val json = JSONArray()
    for (index in 0 until array.size()) {
      when (array.getType(index)) {
        ReadableType.Null -> json.put(JSONObject.NULL)
        ReadableType.Boolean -> json.put(array.getBoolean(index))
        ReadableType.Number -> json.put(array.getDouble(index))
        ReadableType.String -> json.put(array.getString(index))
        ReadableType.Map -> json.put(readableMapToJson(array.getMap(index)!!))
        ReadableType.Array -> json.put(readableArrayToJson(array.getArray(index)!!))
      }
    }
    return json
  }
}
