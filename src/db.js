// node:sqlite é built-in no Node.js >= 22.15 (estável no v24)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'schedules.db'));

// WAL mode: melhor performance com leituras concorrentes
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    text        TEXT    NOT NULL,
    group_id    TEXT    NOT NULL,
    group_name  TEXT,
    send_at     TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')),
    sent_at     TEXT,
    error_msg   TEXT
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_status_send_at
    ON scheduled_messages (status, send_at)
`);

module.exports = db;
