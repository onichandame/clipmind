export interface MigrationStep {
  id: string;
  description: string;
  // Must be idempotent: probe current state, converge if needed, no-op if already converged.
  // Returns 'applied' (work was done) | 'skipped' (state already matched) for logging.
  apply(): Promise<'applied' | 'skipped'>;
}
