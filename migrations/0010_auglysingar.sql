-- Auglýsingar á forsíðu: hver auglýsing fer í eitt auglýsingapláss (slot)
CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slot TEXT NOT NULL DEFAULT 'forsida-midja',
  image TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  active TEXT NOT NULL DEFAULT 'birt',              -- birt | falin
  active_from TEXT,
  active_to TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ads_slot ON ads(slot, active);
