import type { Pool } from 'mysql2/promise';

const LOCK_NAME = 'clipmind:migrate';
const TIMEOUT_S = 300;

// MySQL GET_LOCK is per-connection. We pin one PoolConnection so RELEASE_LOCK
// lands on the same physical connection as GET_LOCK; otherwise the lock dangles
// for `wait_timeout` (~10 min default) and blocks subsequent boots.
//
// The lock connection is only the lock holder — migration steps run their own
// queries through their own connections (Drizzle's pool, ali-oss HTTP client).
// Advisory locks don't need to be on the same connection that does the work.
export async function withMigrationLock<T>(
  pool: Pool,
  fn: () => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    const [rows]: any = await conn.query('SELECT GET_LOCK(?, ?) AS got', [LOCK_NAME, TIMEOUT_S]);
    if (rows?.[0]?.got !== 1) {
      throw new Error(`[migrator] failed to acquire migration lock within ${TIMEOUT_S}s`);
    }
    try {
      return await fn();
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {
        /* swallow — connection may already be dead */
      });
    }
  } finally {
    conn.release();
  }
}
