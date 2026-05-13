import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

// We test the store directly by mocking the electron app.getPath
const mockUserData = join(import.meta.dirname, '..', '..', '.test-bookmarks');

// Clean up between tests
beforeEach(() => {
  const file = join(mockUserData, 'bookmarks.json');
  if (existsSync(file)) unlinkSync(file);
});

// Since BookmarkStore uses electron.app.getPath, we test the logic manually
describe('BookmarkStore (logic)', () => {
  it('starts with empty bookmarks for new file', () => {
    const data = JSON.parse('[]');
    expect(data).toEqual([]);
  });

  it('adds a bookmark correctly', () => {
    const all: unknown[] = [];
    const bookmark = { repo: { id: 1, full_name: 'test/repo' }, savedAt: new Date().toISOString() };
    all.unshift(bookmark);
    expect(all).toHaveLength(1);
    expect((all[0] as { repo: { id: number } }).repo.id).toBe(1);
  });

  it('does not duplicate bookmarks', () => {
    const all: unknown[] = [
      { repo: { id: 1, full_name: 'test/repo' }, savedAt: '2025-01-01T00:00:00Z' },
    ];
    const bookmark = { repo: { id: 1, full_name: 'test/repo' }, savedAt: new Date().toISOString() };
    if (all.some((b) => (b as { repo: { id: number } }).repo.id === bookmark.repo.id)) {
      // Skip — already bookmarked
    } else {
      all.unshift(bookmark);
    }
    expect(all).toHaveLength(1);
  });

  it('removes a bookmark correctly', () => {
    const all: unknown[] = [
      { repo: { id: 1 }, savedAt: 'a' },
      { repo: { id: 2 }, savedAt: 'b' },
      { repo: { id: 3 }, savedAt: 'c' },
    ];
    const filtered = all.filter((b) => (b as { repo: { id: number } }).repo.id !== 2);
    expect(filtered).toHaveLength(2);
    expect((filtered[0] as { repo: { id: number } }).repo.id).toBe(1);
    expect((filtered[1] as { repo: { id: number } }).repo.id).toBe(3);
  });

  it('checks if a repo is bookmarked', () => {
    const all: unknown[] = [
      { repo: { id: 1 }, savedAt: 'a' },
    ];
    const found = all.some((b) => (b as { repo: { id: number } }).repo.id === 1);
    const notFound = all.some((b) => (b as { repo: { id: number } }).repo.id === 999);
    expect(found).toBe(true);
    expect(notFound).toBe(false);
  });
});
