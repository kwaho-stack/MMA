const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'mediadot.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#3987e5',
  auto_enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS media_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  url TEXT DEFAULT '',
  credentials TEXT DEFAULT '{}',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ad_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  credentials TEXT DEFAULT '{}',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS matchings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_account_id INTEGER NOT NULL REFERENCES media_accounts(id) ON DELETE CASCADE,
  ad_account_id INTEGER NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  note TEXT DEFAULT '',
  UNIQUE(media_account_id, ad_account_id)
);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  keywords TEXT DEFAULT '',
  angle TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'pool',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  body TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  status TEXT DEFAULT 'generating',
  policy_report TEXT DEFAULT '{}',
  error TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  media_account_id INTEGER REFERENCES media_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  title TEXT DEFAULT '',
  body TEXT DEFAULT '',
  extra TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  scheduled_at TEXT,
  published_at TEXT,
  published_url TEXT DEFAULT '',
  simulated INTEGER DEFAULT 0,
  error TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS revenues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_account_id INTEGER REFERENCES ad_accounts(id) ON DELETE CASCADE,
  media_account_id INTEGER REFERENCES media_accounts(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'KRW',
  memo TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT DEFAULT 'info',
  message TEXT NOT NULL,
  meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

// 스키마 마이그레이션 — 기존 DB에 새 컬럼을 추가한다(이미 있으면 무시).
function ensureColumn(table, ddl) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); } catch { /* 이미 존재 */ }
}
ensureColumn('revenues', `source TEXT DEFAULT 'manual'`);      // 'manual' | 'sync'
ensureColumn('ad_accounts', 'last_sync_at TEXT');
ensureColumn('ad_accounts', `sync_error TEXT DEFAULT ''`);

const DEFAULT_SETTINGS = {
  publish_mode: 'confirm',          // 'auto' = 예약시간에 자동 발행, 'confirm' = 사용자 최종 컨펌 후 발행
  schedule_enabled: '0',            // 정기 자동발행 파이프라인 on/off
  schedule_times: '09:30,19:30',    // 자동발행 실행 시각 (HH:MM, 콤마 구분)
  publish_gap_min: '25',            // 계정 간 발행 간격(분) — 동시 대량 발행으로 스팸 판정되는 것 방지
  daily_limit_per_account: '3',     // 계정별 1일 발행 상한
  simulate_publish: '1',            // 1 = 시뮬레이션 발행(외부 API 호출 안 함). 실계정 연동 후 0으로.
  llm_model: 'claude-opus-4-8',
  anthropic_api_key: '',
  revenue_sync_enabled: '1',        // 매일 정해진 시각에 수익 자동 동기화
  revenue_sync_time: '06:10',       // 동기화 실행 시각 (전일 데이터 확정 이후 새벽 권장)
  revenue_sync_days: '7',           // 매 동기화 시 가져올 최근 일수 (지연 확정 수치 보정용)
  usd_krw_rate: '1400',             // USD 정산 플랫폼(타불라 등) 원화 환산 환율
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  return DEFAULT_SETTINGS[key] ?? null;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function getAllSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function log(type, message, meta = {}) {
  db.prepare('INSERT INTO activity_log(type, message, meta) VALUES(?, ?, ?)')
    .run(type, message, JSON.stringify(meta));
}

module.exports = { db, getSetting, setSetting, getAllSettings, log, DEFAULT_SETTINGS };
