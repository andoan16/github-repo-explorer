import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

const api = {
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  saveSettings: (settings: unknown) => ipcRenderer.invoke(IPC.SAVE_SETTINGS, settings),
  checkOllama: (baseUrl?: string) => ipcRenderer.invoke(IPC.OLLAMA_CHECK, baseUrl),
  listModels: () => ipcRenderer.invoke(IPC.OLLAMA_MODELS),
  checkGitHub: (token?: string) => ipcRenderer.invoke(IPC.GITHUB_CHECK, token),
  search: (request: string, filters?: unknown) => ipcRenderer.invoke(IPC.SEARCH, request, filters),
  getBookmarks: () => ipcRenderer.invoke(IPC.BOOKMARKS_GET_ALL),
  addBookmark: (bookmark: unknown) => ipcRenderer.invoke(IPC.BOOKMARKS_ADD, bookmark),
  removeBookmark: (repoId: number) => ipcRenderer.invoke(IPC.BOOKMARKS_REMOVE, repoId),
  cloneRepo: (repoUrl: string, repoName: string) => ipcRenderer.invoke(IPC.CLONE_REPO, repoUrl, repoName),
  refine: (refinementText: string) => ipcRenderer.invoke(IPC.SEARCH_REFINE, refinementText),
  generateExplanation: (repoName: string, repoDescription: string | null, requestContext: string) =>
    ipcRenderer.invoke(IPC.GENERATE_EXPLANATION, { repoName, repoDescription, requestContext }),
  onSuggestionsUpdate: (callback: (suggestions: string[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { suggestions: string[] }) => {
      callback(data.suggestions);
    };
    ipcRenderer.on(IPC.SUGGESTIONS_UPDATE, handler);
    return () => { ipcRenderer.removeListener(IPC.SUGGESTIONS_UPDATE, handler); };
  },
};

contextBridge.exposeInMainWorld('repoExplorer', api);

export type RepoExplorerApi = typeof api;
