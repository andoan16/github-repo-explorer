import { SettingsStore } from './settings/store';
import { BookmarkStore } from './bookmarks/store';
import { registerSettingsHandlers } from './handlers/settings.handler';
import { registerBookmarkHandlers } from './handlers/bookmark.handler';
import { registerLlmHandlers } from './handlers/llm.handler';
import { registerGitHandlers } from './handlers/git.handler';
import { registerSearchHandlers } from './handlers/search.handler';

const settings = new SettingsStore();
const bookmarks = new BookmarkStore();

/**
 * Root IPC Handler Registration.
 * Dispatches initialization and registration across modular, single-responsibility handlers.
 */
export function registerIpcHandlers(): void {
  registerSettingsHandlers(settings);
  registerBookmarkHandlers(bookmarks);
  registerLlmHandlers(settings);
  registerGitHandlers();
  registerSearchHandlers(settings);
}
