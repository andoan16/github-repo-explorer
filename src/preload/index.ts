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
};

contextBridge.exposeInMainWorld('repoExplorer', api);

export type RepoExplorerApi = typeof api;
