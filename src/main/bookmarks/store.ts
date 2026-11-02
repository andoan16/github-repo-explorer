import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Bookmark } from '../../shared/types';

export class BookmarkStore {
  private filePath: string;

  constructor() {
    this.filePath = join(app.getPath('userData'), 'bookmarks.json');
  }

  getAll(): Bookmark[] {
    try {
      if (!existsSync(this.filePath)) return [];
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as Bookmark[];
    } catch {
      return [];
    }
  }

  add(bookmark: Bookmark): Bookmark[] {
    if (!bookmark || typeof bookmark !== 'object' || !bookmark.repo || !Number.isInteger(bookmark.repo.id)) {
      return this.getAll();
    }
    const all = this.getAll();
    if (all.some((b) => b.repo?.id === bookmark.repo.id)) return all;
    // Cap maximum stored bookmarks to prevent disk exhaustion (CWE-400)
    if (all.length >= 1000) {
      all.pop();
    }
    all.unshift(bookmark);
    this.write(all);
    return all;
  }

  remove(repoId: number): Bookmark[] {
    if (!Number.isInteger(repoId)) return this.getAll();
    const filtered = this.getAll().filter((b) => b.repo?.id !== repoId);
    this.write(filtered);
    return filtered;
  }

  isBookmarked(repoId: number): boolean {
    if (!Number.isInteger(repoId)) return false;
    return this.getAll().some((b) => b.repo?.id === repoId);
  }

  private write(data: Bookmark[]): void {
    try {
      const dir = join(this.filePath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    } catch (err) {
      console.error('Failed to save bookmarks:', err);
    }
  }
}
