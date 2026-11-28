-- Ný HSK met skráð í vefumsjón; birtast í sömu töflu og met úr metaskrám
CREATE TABLE IF NOT EXISTS record_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  result TEXT NOT NULL,
  athlete TEXT NOT NULL DEFAULT '',
  club TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'utanhuss',
  age_group TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  place TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS record_entries_date ON record_entries(date DESC);
