const importLocks = new Map<string, Promise<void>>();

export async function withFileHashLock<T>(fileHash: string, fn: () => Promise<T>): Promise<T> {
  const previous = importLocks.get(fileHash) ?? Promise.resolve();
  let release!: () => void;
  const current = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  importLocks.set(fileHash, current);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (importLocks.get(fileHash) === current) importLocks.delete(fileHash);
  }
}
