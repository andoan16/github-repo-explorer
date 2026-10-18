import { describe, it, expect, vi } from 'vitest';
import { boundedAllSettled, getGitHubConcurrency } from '@main/utils/concurrency';

describe('boundedAllSettled', () => {
  it('returns empty array when no tasks provided', async () => {
    const result = await boundedAllSettled([]);
    expect(result).toEqual([]);
  });

  it('executes all tasks successfully', async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];
    const result = await boundedAllSettled(tasks, 2);
    expect(result).toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 3 },
    ]);
  });

  it('handles mixed success and failure', async () => {
    const error = new Error('Task failed');
    const tasks = [
      () => Promise.resolve('success'),
      () => Promise.reject(error),
      () => Promise.resolve('another success'),
    ];
    const result = await boundedAllSettled(tasks, 2);
    expect(result).toEqual([
      { status: 'fulfilled', value: 'success' },
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: 'another success' },
    ]);
  });

  it('respects concurrency limit', async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;

    const createTask = () => async () => {
      activeTasks++;
      maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeTasks--;
      return 'done';
    };

    const tasks = Array.from({ length: 10 }, createTask);

    await boundedAllSettled(tasks, 3);

    expect(maxActiveTasks).toBe(3);
    expect(activeTasks).toBe(0);
  });

  it('aborts execution when signal is aborted before starting', async () => {
    const controller = new AbortController();
    controller.abort();

    const task = vi.fn().mockResolvedValue(1);
    const tasks = [task, task, task];

    const result = await boundedAllSettled(tasks, 2, controller.signal);

    expect(task).not.toHaveBeenCalled();
    expect(result).toHaveLength(3);
    result.forEach((res) => {
      expect(res.status).toBe('rejected');
      if (res.status === 'rejected') {
        expect(res.reason).toBeInstanceOf(DOMException);
        expect(res.reason.name).toBe('AbortError');
      }
    });
  });

  it('aborts remaining tasks when signal is aborted mid-execution', async () => {
    const controller = new AbortController();

    const task1 = vi.fn().mockImplementation(async () => {
      controller.abort();
      return 1;
    });

    const task2 = vi.fn().mockResolvedValue(2);
    const task3 = vi.fn().mockResolvedValue(3);

    // Concurrency 1 to ensure order and abort happens before others start
    const result = await boundedAllSettled([task1, task2, task3], 1, controller.signal);

    expect(task1).toHaveBeenCalled();
    expect(task2).not.toHaveBeenCalled();
    expect(task3).not.toHaveBeenCalled();

    expect(result[0]).toEqual({ status: 'fulfilled', value: 1 });

    expect(result[1].status).toBe('rejected');
    expect(result[2].status).toBe('rejected');
  });
});

describe('getGitHubConcurrency', () => {
  it('returns 5 when user has token', () => {
    expect(getGitHubConcurrency(true)).toBe(5);
  });

  it('returns 3 when user does not have token', () => {
    expect(getGitHubConcurrency(false)).toBe(3);
  });
});
