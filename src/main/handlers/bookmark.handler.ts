import { ipcMain } from 'electron';
import { IPC, type Bookmark } from '../../shared/types';
import { BookmarkStore } from '../bookmarks/store';

export function registerBookmarkHandlers(bookmarks: BookmarkStore): void {
  ipcMain.handle(IPC.BOOKMARKS_GET_ALL, async () => {
    try {
      return { ok: true, data: bookmarks.getAll() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.BOOKMARKS_ADD, async (_event, bookmark: Bookmark) => {
    try {
      if (!bookmark || typeof bookmark !== 'object' || !bookmark.repo || !Number.isInteger(bookmark.repo.id) || bookmark.repo.id <= 0) {
        return { ok: false, error: 'Invalid bookmark payload: must contain valid repo with positive integer ID' };
      }
      const all = bookmarks.add(bookmark);
      return { ok: true, data: all };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.BOOKMARKS_REMOVE, async (_event, repoId: number) => {
    try {
      if (!Number.isInteger(repoId) || repoId <= 0) {
        return { ok: false, error: 'Invalid repoId: must be a positive integer' };
      }
      const all = bookmarks.remove(repoId);
      return { ok: true, data: all };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
