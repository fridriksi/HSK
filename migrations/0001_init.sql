-- Grunngagnagrunnur fyrir vef HSK

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'club')),
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Síður í veftré. "module" tengir síðu við efnislista (fréttir, mótaskrá o.s.frv.)
CREATE TABLE pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  in_menu INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'frett' CHECK (kind IN ('frett', 'grein', 'adsend')),
  author TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published', 'rejected')),
  published_at TEXT,
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  album_id INTEGER REFERENCES albums(id) ON DELETE SET NULL,
  review_note TEXT NOT NULL DEFAULT '',
  legacy_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX news_pub ON news(status, published_at DESC);
CREATE INDEX news_legacy ON news(legacy_id);

-- Viðburðir og mót (kind = 'vidburdur' eða 'mot')
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'vidburdur' CHECK (kind IN ('vidburdur', 'mot')),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  sport TEXT NOT NULL DEFAULT '',
  age_groups TEXT NOT NULL DEFAULT '',
  organizer TEXT NOT NULL DEFAULT '',
  reg_deadline TEXT,
  attachment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'pending', 'published', 'rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  legacy_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX events_start ON events(status, starts_at);

CREATE TABLE results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT '',
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '',
  attachment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  legacy_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX results_date ON results(status, date DESC);

CREATE TABLE records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  legacy_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  logo TEXT NOT NULL DEFAULT '',
  sports TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  facebook TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  legacy_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE committees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  legacy_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'fundargerd',
  date TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  file TEXT NOT NULL DEFAULT '',
  legacy_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX documents_date ON documents(category, date DESC);

CREATE TABLE sponsors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  logo TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL DEFAULT 'styrktaradili',
  sort INTEGER NOT NULL DEFAULT 0,
  active_from TEXT,
  active_to TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  legacy_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  src TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX photos_album ON photos(album_id, sort);

CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Breytingasaga: afrit af hverju atriði við hverja vistun
CREATE TABLE revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX revisions_entity ON revisions(entity, entity_id, id DESC);

-- Gamlar slóðir af hsk.is sem vísa á nýjar
CREATE TABLE redirects (
  old_key TEXT PRIMARY KEY,
  new_path TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
