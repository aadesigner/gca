/** Run async tasks with a fixed worker pool (no extra dependencies). */
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;

  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

/** Serialize mutations to a shared object from parallel workers. */
export function createProgressLock() {
  let chain: Promise<void> = Promise.resolve();

  return {
    async mutate(fn: () => void | Promise<void>): Promise<void> {
      chain = chain.then(async () => {
        await fn();
      });
      await chain;
    },
  };
}
