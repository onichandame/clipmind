import mysql from 'mysql2/promise';
import { serverConfig } from '../env';
import { STEPS } from './registry';
import { withMigrationLock } from './lock';

export async function runSystemMigrations(): Promise<void> {
  const pool = mysql.createPool({ uri: serverConfig.DATABASE_URL });
  try {
    await withMigrationLock(pool, async () => {
      const t0 = Date.now();
      console.log('[migrator] 🔒 lock acquired');
      for (const step of STEPS) {
        const stepStart = Date.now();
        try {
          const result = await step.apply();
          const ms = Date.now() - stepStart;
          const arrow = result === 'applied' ? '▶' : '↷';
          console.log(`[migrator] ${arrow} ${step.id} ${result} (${ms} ms)`);
        } catch (e) {
          console.error(`[migrator] ✗ ${step.id} failed:`, e);
          throw e;
        }
      }
      console.log(`[migrator] 🔓 done in ${Date.now() - t0} ms`);
    });
  } finally {
    await pool.end();
  }
}
