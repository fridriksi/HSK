-- Aðildarfélög: kennitala og fleiri samfélagsmiðlar
ALTER TABLE clubs ADD COLUMN kennitala TEXT NOT NULL DEFAULT '';
ALTER TABLE clubs ADD COLUMN instagram TEXT NOT NULL DEFAULT '';
ALTER TABLE clubs ADD COLUMN tiktok TEXT NOT NULL DEFAULT '';
ALTER TABLE clubs ADD COLUMN youtube TEXT NOT NULL DEFAULT '';
