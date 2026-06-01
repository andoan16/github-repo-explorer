/**
 * Execute async tasks with bounded concurrency. Returns all results via
 * Promise.allSettled — individual failures don't abort the batch.
 */
export async function boundedAllSettled<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number = 5,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return [];

  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}

/**
 * Compute the optimal GitHub API concurrency based on auth status.
 * Authenticated: 5000 req/hr → concurrency 5 for faster parallel results.
 * Unauthenticated: 60 req/hr → concurrency 3 to avoid rapid rate-limiting.
 */
export function getGitHubConcurrency(hasToken: boolean): number {
  return hasToken ? 5 : 3;
}
