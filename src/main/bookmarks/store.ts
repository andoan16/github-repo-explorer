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
    const all = this.getAll();
    if (all.some((b) => b.repo.id === bookmark.repo.id)) return all;
    all.unshift(bookmark);
    this.write(all);
    return all;
  }

  remove(repoId: number): Bookmark[] {
    const filtered = this.getAll().filter((b) => b.repo.id !== repoId);
    this.write(filtered);
    return filtered;
  }

  isBookmarked(repoId: number): boolean {
    return this.getAll().some((b) => b.repo.id === repoId);
  }

  private write(data: Bookmark[]): void {
    try {
      const dir = join(this.filePath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save bookmarks:', err);
    }
  }
}
