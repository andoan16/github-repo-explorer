import type { RepoExplorerApi } from '../../preload/index';

declare global {
  interface Window {
    repoExplorer: RepoExplorerApi;
  }
}

export {};
