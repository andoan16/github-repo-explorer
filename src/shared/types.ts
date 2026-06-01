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
  requestContext?: string;
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
  weightEmphasis?: WeightEmphasis;
  /** Multilingual expansion: additional query variants generated from translation */
  expandedKeywords?: string[];
  /** Original user query if it was detected as Vietnamese */
  originalQuery?: string;
  /** English translation of the user query (if Vietnamese was detected) */
  englishTranslation?: string;
  /** Extracted technical concepts from multilingual analysis */
  technicalConcepts?: string[];
}

export interface SearchParams {
  query: string;
  language?: string;
  minStars?: number;
  license?: string;
  sort: 'stars' | 'updated' | 'forks';
  order: 'desc' | 'asc';
  perPage: number;
  page?: number;
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

export interface WeightEmphasis {
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  githubToken: '',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  theme: 'system',
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
  CLONE_REPO: 'clone:repo',
  SEARCH_REFINE: 'search:refine',
  GENERATE_EXPLANATION: 'explanation:generate',
  SUGGESTIONS_UPDATE: 'suggestions:update',
  SEARCH_MORE: 'search:more',
  GET_README: 'readme:get',
  RESULTS_UPDATE: 'results:update',
} as const;

// ── Performance tracking ──
/** Phase-level timing breakdown for search pipeline performance monitoring. */
export interface SearchTimings {
  totalMs: number;
  phase: {
    ollamaMs: number;
    githubSearchMs: number;
    rankingMs: number;
    readmeFetchMs: number;
    vietnameseMs: number;
    mergeMs: number;
    suggestionMs: number;
    dedupMs: number;
    phase1Ms: number;
    phase2Ms: number;
  };
  cache: {
    criteriaHits: number;
    criteriaMisses: number;
    criteriaSize: number;
    searchHits: number;
    searchMisses: number;
    searchSize: number;
    readmeHits: number;
    readmeMisses: number;
    readmeSize: number;
  };
}

// ── IPC response wrappers ──
export interface IpcResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
