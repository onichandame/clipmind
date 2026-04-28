import { runMigrations } from '@clipmind/db';
import { serverConfig } from '../../env';
import type { MigrationStep } from '../types';

export const dbSchemaStep: MigrationStep = {
  id: '0001_db_schema',
  description: 'Apply pending Drizzle SQL migrations',
  apply: async () => {
    // Drizzle's migrate() is idempotent via its own __drizzle_migrations table.
    // It returns immediately when every file's hash is already recorded
    // (cheap-no-op path is <50 ms on a small schema), so we always call it
    // and let Drizzle decide whether work is needed.
    await runMigrations(serverConfig.DATABASE_URL);
    return 'applied';
  },
};
