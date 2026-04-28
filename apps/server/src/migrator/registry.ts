import type { MigrationStep } from './types';
import { dbSchemaStep } from './steps/0001_db_schema';
import { ossBucketStep } from './steps/0002_oss_bucket';

// Order matters. New steps append to the end with the next sequential id.
// Each step must be idempotent — re-runs probe current state and converge.
//
// Note: bucket-level config (creation, CORS, lifecycle) is managed manually
// outside this codebase. OSS-related steps here are read-only preflight checks.
export const STEPS: MigrationStep[] = [
  dbSchemaStep,
  ossBucketStep,
];
