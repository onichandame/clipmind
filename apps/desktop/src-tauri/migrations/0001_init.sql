CREATE TABLE IF NOT EXISTS asset_locations (
  media_file_id TEXT PRIMARY KEY NOT NULL,
  local_path    TEXT NOT NULL,
  file_size     INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_locations_sha256 ON asset_locations(sha256);
