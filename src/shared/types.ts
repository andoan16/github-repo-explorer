// ── Ollama ──
export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export interface OllamaStatus {
  connected: boolean;
  error?: string;
  models: OllamaModel[];
}

// ── GitHub ──
export interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  license: { key: string; name: string } | null;
  updated_at: string;
  topics: string[];
  open_issues: number;
  default_branch: string;
  archived: boolean;
}

export interface GitHubSearchResult {
  repo: GitHubRepo;
  readme: string | null;
  score: RelevanceScore;
  matchExplanation: string;
}

// ── Search ──
export interface SearchCriteria {
  keywords: string[];
  technologies: string[];
  intent: string;
  useCase: string;
  minStars: number;
  preferredLicense: string | null;
  requireRecentActivity: boolean;
}

export interface SearchParams {
  query: string;
  language?: string;
  minStars?: number;
  license?: string;
  sort: 'stars' | 'updated' | 'forks';
  order: 'desc' | 'asc';
  perPage: number;
}

// ── Ranking ──
export interface RelevanceScore {
  total: number;
  semanticMatch: number;
  starsScore: number;
  activityScore: number;
  readmeRelevance: number;
  languageMatch: number;
  licenseCompatibility: number;
}

// ── Filters (UI) ──
export interface SearchFilters {
  language: string | null;
  license: string | null;
  minStars: number;
  maxAgeMonths: number | null;
}

// ── Settings ──
export interface AppSettings {
  githubToken: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  theme: 'light' | 'dark' | 'system';
  maxResults: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  githubToken: '',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  theme: 'system',
  maxResults: 20,
};

// ── Bookmarks ──
export interface Bookmark {
  repo: GitHubRepo;
  savedAt: string;
}

// ── IPC channel names ──
export const IPC = {
  OLLAMA_CHECK: 'ollama:check',
  OLLAMA_MODELS: 'ollama:models',
  GITHUB_CHECK: 'github:check',
  SEARCH: 'search:execute',
  GET_SETTINGS: 'settings:get',
  SAVE_SETTINGS: 'settings:save',
  BOOKMARKS_GET_ALL: 'bookmarks:getAll',
  BOOKMARKS_ADD: 'bookmarks:add',
  BOOKMARKS_REMOVE: 'bookmarks:remove',
} as const;

// ── IPC response wrappers ──
export interface IpcResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
