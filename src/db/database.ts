import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;
// 首次初始化的 in-flight Promise。多个并发调用者（如冷启动时同时触发的
// 查询）共享同一个初始化过程，避免各自打开/建表造成竞态——这正是本地 APK
// 冷启动首次进入历史列表查到空结果的根因。
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (initPromise) return initPromise;

  // 把"打开 + 建表 + 迁移"整体作为一个不可分割的初始化过程缓存起来。
  // 只有它完整 resolve 之后，db 才被赋值、后续查询才会执行——杜绝了
  // "DB 刚 open、表/迁移尚未就绪就被查询"的时序竞态。
  initPromise = (async () => {
    const opened = await SQLite.openDatabaseAsync('ysclaude.db');
    try {
      await initTables(opened);
    } catch (e) {
      // initTables 失败时关闭已打开的连接，防止悬空句柄——
      // 下次重试会重新 openDatabaseAsync，不会操作一个半初始化的 db。
      try { await opened.closeAsync(); } catch {}
      throw e;
    }
    db = opened;
    return opened;
  })();

  try {
    return await initPromise;
  } catch (e) {
    // 初始化失败则清空 in-flight Promise，允许下次重试，而不是永久卡死。
    initPromise = null;
    throw e;
  }
}

export async function closeDatabaseConnection(): Promise<string | null> {
  const opened = db || (initPromise ? await initPromise.catch(() => null) : null);
  const databasePath = opened?.databasePath ?? null;
  if (opened) {
    await opened.closeAsync();
  }
  db = null;
  initPromise = null;
  return databasePath;
}

async function initTables(database: SQLite.SQLiteDatabase) {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      pending_response_boundary_message_id TEXT,
      hidden_message_ids TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tool_calls TEXT,
      tool_call_id TEXT,
      tool_invocations TEXT,
      generated_pics TEXT,
      image_generation_reference_uris TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_id ON messages(conversation_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

    CREATE TABLE IF NOT EXISTS diaries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_diaries_updated ON diaries(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_diaries_favorite ON diaries(is_favorite);

    CREATE TABLE IF NOT EXISTS period_records (
      id TEXT PRIMARY KEY,
      start_date TEXT NOT NULL,
      end_date TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_period_records_start ON period_records(start_date DESC);

    CREATE TABLE IF NOT EXISTS daily_papers (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      content_json TEXT,
      sources_json TEXT NOT NULL DEFAULT '[]',
      generated_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_daily_papers_date ON daily_papers(date_key DESC);
    CREATE INDEX IF NOT EXISTS idx_daily_papers_status ON daily_papers(status);

    CREATE TABLE IF NOT EXISTS incoming_letters (
      id TEXT PRIMARY KEY,
      occasion_id TEXT NOT NULL,
      occasion_title TEXT NOT NULL DEFAULT '',
      date_key TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'generating',
      generated_at INTEGER,
      shown_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      error_message TEXT,
      tool_invocations TEXT,
      UNIQUE (occasion_id, date_key)
    );

    CREATE INDEX IF NOT EXISTS idx_incoming_letters_date ON incoming_letters(date_key DESC);
    CREATE INDEX IF NOT EXISTS idx_incoming_letters_status ON incoming_letters(status);

    CREATE TABLE IF NOT EXISTS reading_books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      cover_uri TEXT,
      file_uri TEXT,
      format TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      chapters TEXT NOT NULL DEFAULT '[]',
      reading_offset INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reading_books_updated ON reading_books(updated_at DESC);

    CREATE TABLE IF NOT EXISTS reading_messages (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES reading_books(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reading_messages_book ON reading_messages(book_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS reading_notes (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reading_notes_book ON reading_notes(book_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS reading_highlights (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reading_highlights_book ON reading_highlights(book_id, start_offset ASC);

    CREATE TABLE IF NOT EXISTS reading_book_snapshots (
      book_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS focus_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      timer_mode TEXT NOT NULL DEFAULT 'countdown',
      duration_ms INTEGER NOT NULL DEFAULT 1500000,
      target_count INTEGER NOT NULL DEFAULT 1,
      completed_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_focus_tasks_created ON focus_tasks(created_at DESC);

    CREATE TABLE IF NOT EXISTS focus_sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_title TEXT NOT NULL DEFAULT '',
      timer_mode TEXT NOT NULL DEFAULT 'countdown',
      planned_duration_ms INTEGER NOT NULL DEFAULT 1500000,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      paused_duration_ms INTEGER NOT NULL DEFAULT 0,
      pause_started_at INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      end_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES focus_tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_focus_sessions_started ON focus_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_focus_sessions_task ON focus_sessions(task_id);

    CREATE TABLE IF NOT EXISTS api_usage_events (
      id TEXT PRIMARY KEY,
      feature TEXT NOT NULL DEFAULT 'unknown',
      request_kind TEXT NOT NULL DEFAULT 'chat',
      streaming INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      model TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      conversation_id TEXT,
      message_id TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      cached_tokens INTEGER,
      reasoning_tokens INTEGER,
      details_json TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_usage_started ON api_usage_events(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_usage_feature ON api_usage_events(feature, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_usage_model ON api_usage_events(model, started_at DESC);
  `);

  await runMigrations(database);
}

/**
 * 基于 PRAGMA user_version 的轻量级 schema 迁移。
 * 每次新增迁移时把目标版本号 +1，并在对应 if 块里执行变更。
 */
async function runMigrations(database: SQLite.SQLiteDatabase) {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;

  // v1: 为每个对话独立存储隐藏楼层范围
  // 所有迁移统一用 hasColumn 守卫，而非仅靠 user_version：
  // CREATE TABLE IF NOT EXISTS 已包含最新 schema（含后来迁移新增的列），
  // 全新安装时列已随建表创建，但 user_version 仍为 0——
  // 若仅靠 version 判断就会 ALTER TABLE ADD COLUMN 已存在的列，
  // 触发 "duplicate column name" 导致 NativeDatabase.execAsync 被 reject。
  if (!(await hasColumn(database, 'conversations', 'hidden_ranges'))) {
    await database.execAsync(
      `ALTER TABLE conversations ADD COLUMN hidden_ranges TEXT NOT NULL DEFAULT '[]';`
    );
  }
  if (version < 1) {
    await database.execAsync('PRAGMA user_version = 1;');
  }

  // v2: 为消息记录实际发生的工具调用（用于气泡上方展示）
  if (!(await hasColumn(database, 'messages', 'tool_invocations'))) {
    await database.execAsync(
      `ALTER TABLE messages ADD COLUMN tool_invocations TEXT;`
    );
  }
  if (version < 2) {
    await database.execAsync('PRAGMA user_version = 2;');
  }

  // v3: 为消息添加图片 URI 字段（图片消息 + AI 识图）
  if (!(await hasColumn(database, 'messages', 'image_uri'))) {
    await database.execAsync(
      `ALTER TABLE messages ADD COLUMN image_uri TEXT;`
    );
  }
  if (version < 3) {
    await database.execAsync('PRAGMA user_version = 3;');
  }

  if (version < 4) {
    await database.execAsync('PRAGMA user_version = 4;');
  }

  if (version < 5) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS focus_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        timer_mode TEXT NOT NULL DEFAULT 'countdown',
        duration_ms INTEGER NOT NULL DEFAULT 1500000,
        target_count INTEGER NOT NULL DEFAULT 1,
        completed_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_focus_tasks_created ON focus_tasks(created_at DESC);

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        task_title TEXT NOT NULL DEFAULT '',
        timer_mode TEXT NOT NULL DEFAULT 'countdown',
        planned_duration_ms INTEGER NOT NULL DEFAULT 1500000,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        paused_duration_ms INTEGER NOT NULL DEFAULT 0,
        pause_started_at INTEGER,
        status TEXT NOT NULL DEFAULT 'running',
        end_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES focus_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_focus_sessions_started ON focus_sessions(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_focus_sessions_task ON focus_sessions(task_id);

      PRAGMA user_version = 5;
    `);
  }

  if (version < 6) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS period_records (
        id TEXT PRIMARY KEY,
        start_date TEXT NOT NULL,
        end_date TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_period_records_start ON period_records(start_date DESC);

      PRAGMA user_version = 6;
    `);
  }

  if (version < 7) {
    const periodColumns = await database.getAllAsync<{ name: string; notnull: number }>(
      'PRAGMA table_info(period_records)'
    );
    const endDateColumn = periodColumns.find((column) => column.name === 'end_date');
    if (endDateColumn?.notnull) {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS period_records_next (
          id TEXT PRIMARY KEY,
          start_date TEXT NOT NULL,
          end_date TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        INSERT INTO period_records_next (id, start_date, end_date, created_at, updated_at)
        SELECT id, start_date, end_date, created_at, updated_at FROM period_records;

        DROP TABLE period_records;
        ALTER TABLE period_records_next RENAME TO period_records;
        CREATE INDEX IF NOT EXISTS idx_period_records_start ON period_records(start_date DESC);
      `);
    }
    await database.execAsync('PRAGMA user_version = 7;');
  }

  if (version < 8) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS reading_notes (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reading_notes_book ON reading_notes(book_id, created_at ASC);

      PRAGMA user_version = 8;
    `);
  }

  if (version < 9) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS reading_highlights (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reading_highlights_book ON reading_highlights(book_id, start_offset ASC);

      PRAGMA user_version = 9;
    `);
  }

  if (version < 10) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS reading_notes_next (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT OR REPLACE INTO reading_notes_next (id, book_id, kind, content, created_at, updated_at)
      SELECT id, book_id, kind, content, created_at, updated_at FROM reading_notes;

      DROP TABLE reading_notes;
      ALTER TABLE reading_notes_next RENAME TO reading_notes;
      CREATE INDEX IF NOT EXISTS idx_reading_notes_book ON reading_notes(book_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS reading_highlights_next (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      INSERT OR REPLACE INTO reading_highlights_next (id, book_id, content, start_offset, end_offset, created_at)
      SELECT id, book_id, content, start_offset, end_offset, created_at FROM reading_highlights;

      DROP TABLE reading_highlights;
      ALTER TABLE reading_highlights_next RENAME TO reading_highlights;
      CREATE INDEX IF NOT EXISTS idx_reading_highlights_book ON reading_highlights(book_id, start_offset ASC);

      PRAGMA user_version = 10;
    `);
  }

  if (version < 11) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS reading_book_snapshots (
        book_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );

      PRAGMA user_version = 11;
    `);
  }

  // v12: persist the pending response boundary per conversation.
  if (!(await hasColumn(database, 'conversations', 'pending_response_boundary_message_id'))) {
    await database.execAsync(
      `ALTER TABLE conversations ADD COLUMN pending_response_boundary_message_id TEXT;`
    );
  }
  if (version < 12) {
    await database.execAsync('PRAGMA user_version = 12;');
  }

  if (!(await hasColumn(database, 'conversations', 'hidden_message_ids'))) {
    await database.execAsync(
      `ALTER TABLE conversations ADD COLUMN hidden_message_ids TEXT NOT NULL DEFAULT '[]';`
    );
  }
  if (version < 13) {
    await database.execAsync('PRAGMA user_version = 13;');
  }

  if (!(await hasColumn(database, 'messages', 'generated_pics'))) {
    await database.execAsync(
      `ALTER TABLE messages ADD COLUMN generated_pics TEXT;`
    );
  }
  if (version < 14) {
    await database.execAsync('PRAGMA user_version = 14;');
  }

  if (version < 15) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS api_usage_events (
        id TEXT PRIMARY KEY,
        feature TEXT NOT NULL DEFAULT 'unknown',
        request_kind TEXT NOT NULL DEFAULT 'chat',
        streaming INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'success',
        model TEXT NOT NULL DEFAULT '',
        base_url TEXT NOT NULL DEFAULT '',
        conversation_id TEXT,
        message_id TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        cached_tokens INTEGER,
        reasoning_tokens INTEGER,
        details_json TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_api_usage_started ON api_usage_events(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_api_usage_feature ON api_usage_events(feature, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_api_usage_model ON api_usage_events(model, started_at DESC);

      PRAGMA user_version = 15;
    `);
  }

  if (version < 16) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS daily_papers (
        id TEXT PRIMARY KEY,
        date_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        content_json TEXT,
        sources_json TEXT NOT NULL DEFAULT '[]',
        generated_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_daily_papers_date ON daily_papers(date_key DESC);
      CREATE INDEX IF NOT EXISTS idx_daily_papers_status ON daily_papers(status);

      PRAGMA user_version = 16;
    `);
  }

  // v17: persist reference images that should be passed to the image edit API.
  if (!(await hasColumn(database, 'messages', 'image_generation_reference_uris'))) {
    await database.execAsync(
      `ALTER TABLE messages ADD COLUMN image_generation_reference_uris TEXT;`
    );
  }
  if (version < 17) {
    await database.execAsync('PRAGMA user_version = 17;');
  }

  if (version < 18) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS incoming_letters (
        id TEXT PRIMARY KEY,
        occasion_id TEXT NOT NULL,
        occasion_title TEXT NOT NULL DEFAULT '',
        date_key TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'generating',
        generated_at INTEGER,
        shown_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        error_message TEXT,
        tool_invocations TEXT,
        UNIQUE (occasion_id, date_key)
      );

      CREATE INDEX IF NOT EXISTS idx_incoming_letters_date ON incoming_letters(date_key DESC);
      CREATE INDEX IF NOT EXISTS idx_incoming_letters_status ON incoming_letters(status);

      PRAGMA user_version = 18;
    `);
  }

  if (version < 19) {
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_id
        ON messages(conversation_id, created_at, id);

      PRAGMA user_version = 19;
    `);
  }
}

async function hasColumn(
  database: SQLite.SQLiteDatabase,
  table: string,
  column: string
): Promise<boolean> {
  const rows = await database.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`
  );
  return rows.some((r) => r.name === column);
}
