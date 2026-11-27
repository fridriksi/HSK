-- Umsóknir sem berast í gegnum vefinn (t.d. um styrk úr Verkefnasjóði)
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ny' CHECK (status IN ('ny', 'afgreidd')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS applications_kind ON applications(kind, created_at DESC);
