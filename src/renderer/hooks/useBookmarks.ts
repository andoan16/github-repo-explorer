import { useState, useEffect, useCallback } from 'react';
import type { Bookmark } from '../../shared/types';

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.repoExplorer.getBookmarks().then((res) => {
      if (res.ok && res.data) setBookmarks(res.data as Bookmark[]);
      setLoading(false);
    });
  }, []);

  const isBookmarked = useCallback(
    (repoId: number) => bookmarks.some((b) => b.repo.id === repoId),
    [bookmarks],
  );

  const toggleBookmark = useCallback(async (bookmark: Bookmark) => {
    if (bookmarks.some((b) => b.repo.id === bookmark.repo.id)) {
      const res = await window.repoExplorer.removeBookmark(bookmark.repo.id);
      if (res.ok && res.data) setBookmarks(res.data as Bookmark[]);
    } else {
      const res = await window.repoExplorer.addBookmark(bookmark);
      if (res.ok && res.data) setBookmarks(res.data as Bookmark[]);
    }
  }, [bookmarks]);

  const removeBookmark = useCallback(async (repoId: number) => {
    const res = await window.repoExplorer.removeBookmark(repoId);
    if (res.ok && res.data) setBookmarks(res.data as Bookmark[]);
  }, []);

  return { bookmarks, loading, isBookmarked, toggleBookmark, removeBookmark };
}
