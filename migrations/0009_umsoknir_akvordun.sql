-- Verkefnasjóður: ákvörðun um hverja umsókn og úthlutun sem birtist á vefnum
ALTER TABLE applications ADD COLUMN decision TEXT NOT NULL DEFAULT '';          -- '' | samthykkt | hafnad
ALTER TABLE applications ADD COLUMN award_recipient TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN award_project TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN award_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN award_year INTEGER;
ALTER TABLE applications ADD COLUMN award_round TEXT NOT NULL DEFAULT '';         -- fyrri | seinni | serstok | arleg
ALTER TABLE applications ADD COLUMN award_published INTEGER NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN decided_at TEXT;
ALTER TABLE applications ADD COLUMN decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS applications_award ON applications(decision, award_published);

-- Opið fyrir umsóknir sjálfgefið (stillt í vefumsjón undir Umsóknir í Verkefnasjóð)
INSERT OR IGNORE INTO settings (key, value) VALUES ('grant_open', '1');
