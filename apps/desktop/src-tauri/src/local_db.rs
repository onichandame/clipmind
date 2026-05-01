// Per-device SQLite store for asset metadata that is intrinsically local to
// this machine — primarily the filesystem path of an imported video. Lives
// next to `device_id` under app_data_dir/local_assets.sqlite. The backend
// MySQL purposefully does NOT carry these fields anymore: a single user can
// own the same media_file on multiple devices at different paths.

use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAsset {
    pub local_path: String,
    pub file_size: i64,
    pub sha256: String,
    pub updated_at: i64,
}

pub async fn open_and_migrate(path: &Path) -> Result<SqlitePool, String> {
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await
        .map_err(|e| format!("local SQLite connect failed: {e}"))?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| format!("local SQLite migrate failed: {e}"))?;
    Ok(pool)
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub async fn get(pool: &SqlitePool, media_file_id: &str) -> Result<Option<LocalAsset>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT local_path, file_size, sha256, updated_at \
         FROM asset_locations WHERE media_file_id = ?1",
    )
    .bind(media_file_id)
    .fetch_optional(pool)
    .await?;
    match row {
        None => Ok(None),
        Some(r) => Ok(Some(LocalAsset {
            local_path: r.try_get("local_path")?,
            file_size: r.try_get("file_size")?,
            sha256: r.try_get("sha256")?,
            updated_at: r.try_get("updated_at")?,
        })),
    }
}

pub async fn get_many(
    pool: &SqlitePool,
    media_file_ids: &[String],
) -> Result<HashMap<String, LocalAsset>, sqlx::Error> {
    if media_file_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = std::iter::repeat("?")
        .take(media_file_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT media_file_id, local_path, file_size, sha256, updated_at \
         FROM asset_locations WHERE media_file_id IN ({})",
        placeholders
    );
    let mut q = sqlx::query(&sql);
    for id in media_file_ids {
        q = q.bind(id);
    }
    let rows = q.fetch_all(pool).await?;
    let mut out = HashMap::with_capacity(rows.len());
    for r in rows {
        let id: String = r.try_get("media_file_id")?;
        out.insert(
            id,
            LocalAsset {
                local_path: r.try_get("local_path")?,
                file_size: r.try_get("file_size")?,
                sha256: r.try_get("sha256")?,
                updated_at: r.try_get("updated_at")?,
            },
        );
    }
    Ok(out)
}

pub async fn upsert(
    pool: &SqlitePool,
    media_file_id: &str,
    local_path: &str,
    file_size: i64,
    sha256: &str,
) -> Result<LocalAsset, sqlx::Error> {
    let now = now_secs();
    sqlx::query(
        "INSERT INTO asset_locations (media_file_id, local_path, file_size, sha256, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(media_file_id) DO UPDATE SET \
           local_path = excluded.local_path, \
           file_size = excluded.file_size, \
           sha256 = excluded.sha256, \
           updated_at = excluded.updated_at",
    )
    .bind(media_file_id)
    .bind(local_path)
    .bind(file_size)
    .bind(sha256)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(LocalAsset {
        local_path: local_path.to_string(),
        file_size,
        sha256: sha256.to_string(),
        updated_at: now,
    })
}

pub async fn delete(pool: &SqlitePool, media_file_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM asset_locations WHERE media_file_id = ?1")
        .bind(media_file_id)
        .execute(pool)
        .await?;
    Ok(())
}
