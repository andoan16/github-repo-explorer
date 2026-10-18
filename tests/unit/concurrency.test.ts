import { describe, it, expect } from 'vitest';
import { getGitHubConcurrency } from '../../src/main/utils/concurrency';

describe('getGitHubConcurrency', () => {
  it('should return 5 when hasToken is true', () => {
    expect(getGitHubConcurrency(true)).toBe(5);
  });

  it('should return 3 when hasToken is false', () => {
    expect(getGitHubConcurrency(false)).toBe(3);
  });
});
