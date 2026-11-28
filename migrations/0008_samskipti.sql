-- Samskipti: tengiliðir, útsendingar (fjöldapóstur) og niðurstöður þeirra

-- Tengiliðir sem hægt er að senda á. Félag ræður svæði og íþróttagreinum (úr clubs).
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'felagi',        -- formadur | stjorn | thjalfari | forradamadur | felagi | annad
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'handvirkt',   -- handvirkt | innflutningur | felag
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS contacts_club ON contacts(club_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_club ON contacts(email, IFNULL(club_id, 0)) WHERE email <> '';

-- Útsendingar. sender_club_id NULL = HSK sjálft.
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'email',
  status TEXT NOT NULL DEFAULT 'drog',        -- drog | bidur_samthykktar | timasett | i_sendingu | sent | rusl
  is_template INTEGER NOT NULL DEFAULT 0,
  internal_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  sender_club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  subject TEXT NOT NULL DEFAULT '',
  header_image TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '',
  track_clicks INTEGER NOT NULL DEFAULT 1,
  audience TEXT NOT NULL DEFAULT '{}',
  test_sent_at TEXT,
  scheduled_at TEXT,
  sent_at TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sendable_count INTEGER NOT NULL DEFAULT 0,
  parent_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS campaigns_status ON campaigns(status, updated_at DESC);

-- Einn viðtakandi útsendingar. reason er staðlaður kóði; raw_error geymir hrátt villuboð aðeins hér.
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | sent | delivered | failed | skipped
  reason TEXT NOT NULL DEFAULT '',            -- ekkert_netfang | ogilt_netfang | afthakkad | ovirkt | villa
  raw_error TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  opened_at TEXT,
  clicked_at TEXT
);
CREATE INDEX IF NOT EXISTS campaign_recipients_campaign ON campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS campaign_recipients_message ON campaign_recipients(message_id);

CREATE TABLE IF NOT EXISTS campaign_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES campaign_recipients(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  clicked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS campaign_clicks_campaign ON campaign_clicks(campaign_id);

-- Netföng sem ekki má senda á aftur (hart skopp, ruslpóstskvörtun, handvirkt)
CREATE TABLE IF NOT EXISTS suppressions (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Afskráningar (líka þegar tengiliður er síðar eytt)
CREATE TABLE IF NOT EXISTS unsubscribes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  contact_id INTEGER,
  campaign_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS unsubscribes_created ON unsubscribes(created_at);

-- Sniðmát: fundarboð
INSERT INTO campaigns (status, is_template, internal_name, subject, body_html)
SELECT 'drog', 1, 'Sniðmát: Fundarboð', 'Fundarboð: [heiti fundar]',
  '<p>Kæru félagar,</p><p>Boðað er til [heiti fundar] [Dagsetning] kl. [tími] í [fundarstaður].</p><p><strong>Dagskrá:</strong></p><ol><li>Fundarsetning</li><li>[Dagskrárliður]</li><li>Önnur mál</li></ol><p>Með kveðju,<br>[Nafn], formaður</p>'
WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE is_template = 1 AND internal_name = 'Sniðmát: Fundarboð');
