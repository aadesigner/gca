-- Speed up background R2 mirror drain (WHERE stored_path IS NULL ORDER BY id).
CREATE INDEX IF NOT EXISTS photos_pending_mirror_idx ON photos (id DESC) WHERE stored_path IS NULL;
