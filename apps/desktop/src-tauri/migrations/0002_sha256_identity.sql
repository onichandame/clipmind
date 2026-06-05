CREATE TABLE IF NOT EXISTS asset_locations_new (
  sha256        TEXT PRIMARY KEY NOT NULL,
  local_path    TEXT NOT NULL,
  file_size     INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

INSERT OR REPLACE INTO asset_locations_new (sha256, local_path, file_size, updated_at)
SELECT sha256, local_path, file_size, updated_at
FROM asset_locations
ORDER BY updated_at ASC;

DROP TABLE asset_locations;

ALTER TABLE asset_locations_new RENAME TO asset_locations;
