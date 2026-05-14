import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'

let db: Database.Database

export function initDb(): void {
  const dbPath = join(app.getPath('userData'), 'aris.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
}

export function getDb(): Database.Database {
  return db
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_opened INTEGER,
      total_pages INTEGER,
      current_page INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS source_tags (
      source_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (source_id, tag),
      FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS highlight_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      highlight_type_id TEXT,
      selected_text TEXT NOT NULL,
      rects TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE,
      FOREIGN KEY (highlight_type_id) REFERENCES highlight_types(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      highlight_id TEXT,
      term TEXT NOT NULL,
      definition TEXT NOT NULL,
      chapter TEXT,
      page_number INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE,
      FOREIGN KEY (highlight_id) REFERENCES highlights(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS source_outline_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      parent_id TEXT,
      title TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      origin TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_outline_source ON source_outline_items(source_id, sort_order);

    CREATE TABLE IF NOT EXISTS note_links (
      from_note_id TEXT NOT NULL,
      to_note_id TEXT NOT NULL,
      relationship TEXT,
      PRIMARY KEY (from_note_id, to_note_id),
      FOREIGN KEY (from_note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_note_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS flashcard_state (
      note_id TEXT PRIMARY KEY,
      next_review INTEGER NOT NULL,
      interval_stage INTEGER DEFAULT 0,
      consecutive_correct INTEGER DEFAULT 0,
      last_reviewed INTEGER,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reading_goals (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL UNIQUE,
      finish_by INTEGER NOT NULL,
      reminder_frequency TEXT,
      reminder_day INTEGER,
      reminder_time TEXT,
      estimated_word_count INTEGER,
      words_per_page REAL,
      last_reminded_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapter_deadlines (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      outline_item_id TEXT,
      chapter_name TEXT NOT NULL,
      finish_by INTEGER NOT NULL,
      FOREIGN KEY (goal_id) REFERENCES reading_goals(id) ON DELETE CASCADE
    );
  `)

  // ── Incremental migrations (additive columns / one-off cleanups) ────────────
  // SQLite lacks ADD COLUMN IF NOT EXISTS, so probe pragma_table_info first.
  const noteCols = db.prepare(`PRAGMA table_info(notes)`).all() as { name: string }[]
  if (!noteCols.some((c) => c.name === 'outline_item_id')) {
    db.exec(`ALTER TABLE notes ADD COLUMN outline_item_id TEXT`)
  }

  const hlCols = db.prepare(`PRAGMA table_info(highlights)`).all() as { name: string }[]
  if (!hlCols.some((c) => c.name === 'cfi')) {
    db.exec(`ALTER TABLE highlights ADD COLUMN cfi TEXT`)
  }

  const srcCols = db.prepare(`PRAGMA table_info(knowledge_sources)`).all() as { name: string }[]
  if (!srcCols.some((c) => c.name === 'scroll_fraction')) {
    db.exec(`ALTER TABLE knowledge_sources ADD COLUMN scroll_fraction REAL DEFAULT 0`)
  }
  if (!srcCols.some((c) => c.name === 'epub_cfi')) {
    db.exec(`ALTER TABLE knowledge_sources ADD COLUMN epub_cfi TEXT`)
  }
  if (!srcCols.some((c) => c.name === 'cover_image')) {
    db.exec(`ALTER TABLE knowledge_sources ADD COLUMN cover_image TEXT`)
  }
  if (!srcCols.some((c) => c.name === 'author')) {
    db.exec(`ALTER TABLE knowledge_sources ADD COLUMN author TEXT`)
  }
  if (!srcCols.some((c) => c.name === 'publication_year')) {
    db.exec(`ALTER TABLE knowledge_sources ADD COLUMN publication_year INTEGER`)
  }
  if (!srcCols.some((c) => c.name === 'publisher')) {
    db.exec(`ALTER TABLE knowledge_sources ADD COLUMN publisher TEXT`)
  }
  if (!srcCols.some((c) => c.name === 'edition')) {
    db.exec(`ALTER TABLE knowledge_sources ADD COLUMN edition TEXT`)
  }

  const nodePosCols = db.prepare(`PRAGMA table_info(node_positions)`).all() as { name: string }[]
  if (nodePosCols.length === 0) {
    db.exec(`CREATE TABLE node_positions (
      note_id TEXT PRIMARY KEY,
      x REAL NOT NULL,
      y REAL NOT NULL,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    )`)
  }

  // ── Knowledge graphs migration ─────────────────────────────────────────────
  const kgCols = db.prepare(`PRAGMA table_info(knowledge_graphs)`).all() as { name: string }[]
  if (kgCols.length === 0) {
    const defaultId = randomUUID()
    const now = Date.now()

    db.exec(`
      CREATE TABLE knowledge_graphs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    db.prepare(`INSERT INTO knowledge_graphs (id, name, created_at) VALUES (?, ?, ?)`)
      .run(defaultId, 'My Knowledge Graph', now)

    // Migrate note_links: add graph_id to composite PK
    db.exec(`ALTER TABLE note_links RENAME TO note_links_old`)
    db.exec(`
      CREATE TABLE note_links (
        graph_id TEXT NOT NULL,
        from_note_id TEXT NOT NULL,
        to_note_id TEXT NOT NULL,
        relationship TEXT,
        PRIMARY KEY (graph_id, from_note_id, to_note_id),
        FOREIGN KEY (graph_id) REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
        FOREIGN KEY (from_note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_note_id) REFERENCES notes(id) ON DELETE CASCADE
      )
    `)
    db.prepare(
      `INSERT INTO note_links (graph_id, from_note_id, to_note_id, relationship)
       SELECT ?, from_note_id, to_note_id, relationship FROM note_links_old`
    ).run(defaultId)
    db.exec(`DROP TABLE note_links_old`)

    // Migrate node_positions: add graph_id (table exists without it after earlier migration)
    const npCols = db.prepare(`PRAGMA table_info(node_positions)`).all() as { name: string }[]
    if (npCols.length === 0) {
      db.exec(`
        CREATE TABLE node_positions (
          graph_id TEXT NOT NULL,
          note_id TEXT NOT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          PRIMARY KEY (graph_id, note_id),
          FOREIGN KEY (graph_id) REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
      `)
    } else if (!npCols.some((c) => c.name === 'graph_id')) {
      db.exec(`ALTER TABLE node_positions RENAME TO node_positions_old`)
      db.exec(`
        CREATE TABLE node_positions (
          graph_id TEXT NOT NULL,
          note_id TEXT NOT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          PRIMARY KEY (graph_id, note_id),
          FOREIGN KEY (graph_id) REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
      `)
      db.prepare(
        `INSERT INTO node_positions (graph_id, note_id, x, y)
         SELECT ?, note_id, x, y FROM node_positions_old`
      ).run(defaultId)
      db.exec(`DROP TABLE node_positions_old`)
    }
  }

  // Seed default highlight types if none exist
  const count = db.prepare('SELECT COUNT(*) as c FROM highlight_types').get() as { c: number }
  if (count.c === 0) {
    const insert = db.prepare(
      'INSERT INTO highlight_types (id, name, color, description) VALUES (?, ?, ?, ?)'
    )
    const defaults = [
      ['ht-main-idea', 'Main Idea', '#2978a0', 'Key concepts and central arguments'],
      ['ht-definition', 'Definition', '#7fbeab', 'Definitions and explanations'],
      ['ht-open-question', 'Open Question', '#aea3b0', 'Things to investigate further'],
      ['ht-important', 'Important', '#e3d0d8', 'Critical information to remember'],
    ]
    const insertMany = db.transaction(() => {
      for (const row of defaults) insert.run(...row)
    })
    insertMany()
  }
}
