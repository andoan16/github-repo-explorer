/**
 * Vietnamese multilingual search support.
 *
 * Detects Vietnamese input, translates key terms to English, and generates
 * multiple search variants so the system finds repos regardless of the
 * language of their metadata.
 *
 * Performance design:
 *  - Translation is done once per query and cached (TTL 30 min, LRU 200).
 *  - No additional GitHub API calls — expanded queries reuse the same search
 *    pipeline, just with more keyword variants.
 *  - The translation uses the existing Ollama call (piggybacked on
 *    extractCriteria), not a separate LLM invocation.
 */

import type { OllamaClient } from '../ollama/client';

// ── Vietnamese detection ──

/**
 * Unicode ranges that are strong indicators of Vietnamese text.
 * Covers the full set of Vietnamese diacritics used in modern orthography,
 * including the Latin Extended Additional block (U+1E00-U+1EFF) which
 * contains the vast majority of Vietnamese precomposed characters
 * (e.g., ả ấ ầ ẩ ậ ặ ắ ờ ở ỡ ỷ etc.).
 */
const VIETNAMESE_RANGES = [
  /[\u00C0-\u00C5]/, // À-Å
  /[\u00C8-\u00CB]/, // È-Ë
  /[\u00CC-\u00CF]/, // Ì-Ï
  /[\u00D2-\u00D6]/, // Ò-Ö
  /[\u00D9-\u00DC]/, // Ù-Ü
  /[\u00E0-\u00E5]/, // à-å
  /[\u00E8-\u00EB]/, // è-ë
  /[\u00EC-\u00EF]/, // ì-ï
  /[\u00F2-\u00F6]/, // ò-ö
  /[\u00F9-\u00FC]/, // ù-ü
  /[\u0102\u0103]/,   // Ă ă
  /[\u0110\u0111]/,   // Đ đ
  /[\u0128\u0129]/,   // Ĩ ĩ
  /[\u0168\u0169]/,   // Ũ ũ
  /[\u01A0\u01A1]/,   // Ơ ơ
  /[\u01AF\u01B0]/,   // Ư ư
  /[\u1E00-\u1EFF]/, // Latin Extended Additional (ả ấ ầ ẩ ậ ệ ộ ố ờ ỷ …)
];

/** Vietnamese-specific combining marks (hook above, breve, dot below, horn) */
const VIETNAMESE_MARKS = /[\u0300-\u0309\u0303\u030B\u0323]/;

/**
 * Common Vietnamese words that appear in search queries.
 * If a text contains these alongside Vietnamese diacritics, it's almost
 * certainly Vietnamese rather than another Romance language using accents.
 */
const VIETNAMESE_MARKER_WORDS = new Set([
  'tôi', 'muốn', 'cần', 'một', 'tìm', 'công', 'cụ', 'quản', 'lý',
  'hệ', 'thống', 'máy', 'chủ', 'dịch', 'vụ', 'cho', 'việc', 'làm',
  'nền', 'tảng', 'tự', 'động', 'mã', 'nguồn', 'mở', 'phép', 'thuật',
  'hỗ', 'trợ', 'ưu', 'thiên', 'chỉ', 'ít', 'nhiều', 'hơn', 'giữa',
  'sử', 'dụng', 'phát', 'triển', 'ứng', 'dụng', 'bảo', 'mật', 'khóa',
  'an', 'toàn', 'dữ', 'liệu', 'thông', 'tin', 'tác', 'nhân', 'chạy',
  'riêng', 'biệt', 'riêng', 'cùng', 'thuộc', 'biểu', 'mẫy', 'theo',
  'dõi', 'nhật', 'ký', 'nhắc', 'nhở', 'truy', 'vấn', 'câu', 'truy',
  'lập', 'trình', 'ngôn', 'ngữ', 'khai', 'thác', 'học', 'thuật',
  'chú', 'giải', 'tài', 'liệu', 'thư', 'viện', 'khung', 'mô', 'hình',
  'kiểm', 'soát', 'phiên', 'bản', 'phân', 'tích', 'tích', 'hợp',
  'kết', 'nối', 'mạng', 'lưới', 'đám', 'mây', 'riêng', 'tư',
]);

/**
 * Returns a confidence score (0–1) that the given text is Vietnamese.
 * Uses diacritic detection + marker word matching for robustness.
 */
export function detectVietnamese(text: string): number {
  if (!text || text.trim().length === 0) return 0;

  // Check for Vietnamese-specific characters (present in almost all Vietnamese text)
  let diacriticHits = 0;
  for (const range of VIETNAMESE_RANGES) {
    if (range.test(text)) diacriticHits++;
  }
  if (VIETNAMESE_MARKS.test(text)) diacriticHits++;

  // Quick reject: if no Vietnamese diacritics at all, it's probably not Vietnamese
  if (diacriticHits === 0) return 0;

  // Count Vietnamese marker words
  const lower = text.toLowerCase();
  const words = lower.split(/[\s,;.!?(){}[\]]+/).filter(w => w.length > 0);
  let markerHits = 0;
  for (const word of words) {
    if (VIETNAMESE_MARKER_WORDS.has(word)) markerHits++;
  }

  // Vietnamese-specific characters that don't appear in French/Portuguese/Spanish.
  // Includes: ơ ư ă đ (base forms) AND Latin Extended Additional precomposed
  // characters (ả ấ ầ ẩ ậ ặ ắ ờ ở ỡ ỷ ệ ộ ố …) which are uniquely Vietnamese.
  const vietnameseSpecific = /[ăơưâêôđ\u1EA0-\u1EFF]/i;
  const hasVietSpecific = vietnameseSpecific.test(text);

  // Score: diacritics provide baseline, markers boost, Vietnamese-specific chars boost more
  let score = Math.min(diacriticHits / 3, 1) * 0.4;
  if (words.length > 0) {
    score += (markerHits / words.length) * 0.4;
  }
  if (hasVietSpecific) score += 0.2;

  return Math.min(score, 1);
}

// ── Vietnamese→English dictionary for local (non-LLM) translation ──

/**
 * Common Vietnamese IT/tech terms and their English equivalents.
 * Used for fast local translation without needing an LLM call.
 * This handles the most common cases; the LLM handles everything else.
 */
const VIETNAMESE_TECH_DICTIONARY: Record<string, string[]> = {
  // ── Infrastructure / DevOps ──
  'giám sát': ['monitoring', 'observability'],
  'máy chủ': ['server', 'host'],
  'tự host': ['self-hosted', 'self-host'],
  'tự chạy': ['self-hosted', 'self-host'],
  'riêng tư': ['self-hosted', 'private'],
  'triển khai': ['deployment', 'deploy'],
  'vận hành': ['operations', 'ops'],
  'mạng': ['network', 'networking'],
  'đám mây': ['cloud'],
  'máy ảo': ['virtual machine', 'vm'],
  'phân tán': ['distributed'],
  'khám': ['discovery', 'service-discovery'],
  'cân bằng tải': ['load balancer', 'load-balancing'],
  'tường lửa': ['firewall'],

  // ── CI/CD ──
  'tích hợp liên tục': ['continuous integration', 'ci-cd'],
  'triển khai liên tục': ['continuous deployment', 'ci-cd'],
  'đường ống': ['pipeline', 'ci-cd'],
  'ống dẫn': ['pipeline', 'ci-cd'],
  'xây dựng': ['build', 'ci'],
  'kiểm thử': ['testing', 'test'],

  // ── Security ──
  'bảo mật': ['security', 'secure'],
  'mật khẩu': ['password', 'credential'],
  'quản lý mật khẩu': ['password manager', 'credential management'],
  'quản lý bí mật': ['secret management', 'secrets'],
  'bí mật': ['secret', 'secrets'],
  'mã hóa': ['encryption', 'crypto'],
  'chứng thực': ['authentication', 'auth'],
  'phân quyền': ['authorization', 'rbac'],
  'an toàn': ['security', 'safety'],

  // ── Data / Database ──
  'cơ sở dữ liệu': ['database', 'db'],
  'dữ liệu': ['data'],
  'kho dữ liệu': ['data warehouse', 'data-warehouse'],
  'sao lưu': ['backup'],
  'khôi phục': ['recovery', 'restore'],
  'truy vấn': ['query'],
  'lưu trữ': ['storage', 'cache'],
  'bộ nhớ đệm': ['cache', 'caching'],

  // ── Development ──
  'lập trình': ['programming', 'development'],
  'ngôn ngữ lập trình': ['programming language'],
  'thư viện': ['library'],
  'khung': ['framework'],
  'phát triển': ['development'],
  'mã nguồn mở': ['open source', 'open-source'],
  'mã nguồn': ['source code'],
  'gói': ['package', 'module'],
  'đóng gói': ['package', 'packaging'],
  'gỡ lỗi': ['debugging', 'debugger'],
  'biên dịch': ['compiler', 'compilation'],

  // ── Observability ──
  'nền tảng quan sát': ['observability platform', 'monitoring'],
  'theo dõi': ['monitoring', 'tracking'],
  'nhật ký': ['logging', 'logs'],
  'chỉ số': ['metrics'],
  'tracing': ['tracing', 'distributed-tracing'],

  // ── Containerization ──
  'container': ['container', 'docker'],
  'công cụ container': ['container tool', 'docker'],

  // ── Tech terms (English, often mixed into Vietnamese queries) ──
  // These normalize common abbreviations and tech terms
  'ci/cd': ['ci-cd', 'continuous integration'],
  'ci-cd': ['ci-cd', 'continuous integration'],
  'cicd': ['ci-cd', 'continuous integration'],
  'devops': ['devops', 'devsecops'],
  'kubernetes': ['kubernetes', 'k8s'],
  'docker': ['docker', 'containerization'],
  'terraform': ['terraform', 'infrastructure-as-code'],
  'golang': ['go', 'golang'],
  'postgresql': ['postgresql', 'database'],
  'mongodb': ['mongodb', 'database'],
  'redis': ['redis', 'cache'],
  'nginx': ['nginx', 'web-server'],
  'react': ['react', 'frontend'],
  'vue': ['vue', 'frontend'],

  // ── Misc common ──
  'công cụ': ['tool'],
  'nền tảng': ['platform'],
  'hệ thống': ['system'],
  'trình': ['manager', 'runner', 'engine'],
  'quản lý': ['management', 'manager', 'manage'],
  'tự động': ['automation', 'automated', 'auto'],
  'hỗ trợ': ['support'],
  'chỉ': ['only'],
  'ưu tiên': ['prefer'],
  'thiên về': ['lean towards', 'prefer'],
  'ít': ['less', 'fewer'],
  'nhiều': ['more'],
  'giấy phép': ['license'],
  'phiên bản': ['version'],
  'tài liệu': ['documentation', 'docs'],
  'giao diện': ['interface', 'ui', 'dashboard'],
  'đồ họa': ['graphics', 'visualization'],
  'thống kê': ['statistics', 'analytics'],
  'phân tích': ['analytics', 'analysis'],
  'trực quan': ['visualization'],
  'nhắc nhở': ['reminder'],
  'lịch': ['calendar', 'scheduler'],
  'tác nhân': ['agent'],
  'tìm kiếm': ['search'],
  'xác thực': ['authentication', 'oauth'],
  'nhóm': ['group', 'team'],
  'cộng đồng': ['community'],
  'riêng': ['private', 'personal'],
  'cấu hình': ['configuration', 'config'],
  'thông báo': ['notification', 'alert'],
  'bảng điều khiển': ['dashboard', 'control-panel'],
  'tích hợp': ['integration'],
};

/**
 * Common Vietnamese words that should be stripped as stop-words during
 * English query generation (they don't add search value in English context).
 */
const VIETNAMESE_STOP_WORDS = new Set([
  'tôi', 'muốn', 'cần', 'một', 'cho', 'và', 'hoặc', 'của', 'về', 'với',
  'để', 'sẽ', 'đã', 'đang', 'cũng', 'này', 'đó', 'có', 'không', 'nhưng',
  'từ', 'trong', 'ra', 'vào', 'lên', 'xuống', 'nữa', 'rất', 'quá',
  'cái', 'những', 'các', 'vậy', 'thì', 'mà', 'nhé', 'ạ',
]);

export interface MultilingualExpansion {
  /** Original Vietnamese query */
  originalQuery: string;
  /** English translation of the full query */
  englishTranslation: string;
  /** Multiple search keyword variants (Vietnamese + English + technical) */
  searchVariants: string[];
  /** Technical concepts extracted from the query */
  technicalConcepts: string[];
  /** Whether this expansion came from cache */
  fromCache: boolean;
}

/**
 * Expand a Vietnamese query into multilingual search variants.
 *
 * This uses a local dictionary first, then falls back to LLM for
 * phrases not in the dictionary. The goal is to produce 3–5 search
 * variants that cover:
 *   1. Original Vietnamese (exact match)
 *   2. English translation (semantic match)
 *   3. Technical keyword variant (technical match)
 *   4. Alternative terminology (broad match)
 */
export class VietnameseQueryExpander {
  constructor(private ollama?: OllamaClient, private model?: string) {}

  /**
   * Expand a Vietnamese query into multilingual variants.
   * Returns null if the text is not Vietnamese enough.
   */
  async expand(
    userQuery: string,
    signal?: AbortSignal,
    cache?: VietnameseTranslationCache,
  ): Promise<MultilingualExpansion | null> {
    const confidence = detectVietnamese(userQuery);
    if (confidence < 0.3) return null; // Not Vietnamese enough

    // Check cache first
    const cacheKey = VietnameseTranslationCache.key(userQuery);
    if (cache) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }

    // Phase 1: Local dictionary translation (fast, no LLM)
    const localResult = this.localTranslate(userQuery);

    // Phase 2: LLM-powered translation for concepts the dictionary missed
    let llmEnhancement: { translation: string; concepts: string[]; alternatives: string[] } | null = null;
    if (this.ollama && this.model) {
      llmEnhancement = await this.llmTranslate(userQuery, signal);
    }

    // Merge local + LLM results
    const englishTranslation = llmEnhancement?.translation ?? localResult.translation;
    const technicalConcepts = this.mergeUnique(localResult.concepts, llmEnhancement?.concepts ?? []);
    const alternatives = this.mergeUnique(localResult.variants, llmEnhancement?.alternatives ?? []);

    // Build search variants
    const searchVariants = this.buildSearchVariants(
      userQuery,
      englishTranslation,
      technicalConcepts,
      alternatives,
    );

    const result: MultilingualExpansion = {
      originalQuery: userQuery,
      englishTranslation,
      searchVariants,
      technicalConcepts,
      fromCache: false,
    };

    // Cache the result
    if (cache) {
      cache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Local dictionary-based translation.
   * Handles common Vietnamese IT terms without requiring an LLM call.
   */
  private localTranslate(query: string): {
    translation: string;
    concepts: string[];
    variants: string[];
  } {
    const lower = query.toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length > 0);

    const translatedParts: string[] = [];
    const concepts: string[] = [];
    const variants: string[] = [];

    // Sliding window: try multi-word matches first (longer phrases are more specific)
    const maxPhraseLen = 4; // longest phrase in dictionary is 4 words
    let i = 0;
    const usedIndices = new Set<number>();

    while (i < words.length) {
      let matched = false;

      // Try longest phrase first, then shorter
      for (let len = Math.min(maxPhraseLen, words.length - i); len >= 1; len--) {
        const phrase = words.slice(i, i + len).join(' ');

        if (VIETNAMESE_TECH_DICTIONARY[phrase]) {
          const translations = VIETNAMESE_TECH_DICTIONARY[phrase];
          translatedParts.push(translations[0]); // primary translation
          concepts.push(...translations);
          for (let j = i; j < i + len; j++) usedIndices.add(j);
          matched = true;
          i += len;
          break;
        }
      }

      if (!matched) {
        // Check if it's a stop word or a technical term
        const word = words[i];
        if (!VIETNAMESE_STOP_WORDS.has(word) && word.length >= 2) {
          // Might be a tech term in English already (e.g., "docker", "kubernetes")
          translatedParts.push(word);
        }
        i++;
      }
    }

    const translation = translatedParts.length > 0
      ? translatedParts.join(' ')
      : query; // fallback to original if nothing translated

    // Build variant: just the key tech concepts as a compact query
    if (concepts.length > 0) {
      const topConcepts = concepts.slice(0, 3).join(' ');
      variants.push(topConcepts);
    }

    return { translation, concepts, variants };
  }

  /**
   * LLM-powered translation for phrases not in the local dictionary.
   * Produces an English translation + extracted technical concepts + alternatives.
   */
  private async llmTranslate(
    query: string,
    signal?: AbortSignal,
  ): Promise<{ translation: string; concepts: string[]; alternatives: string[] } | null> {
    if (!this.ollama || !this.model) return null;

    const prompt = `You are a multilingual search assistant. A Vietnamese-speaking user is searching GitHub for repositories.

Vietnamese query: "${query}"

Provide an English translation and technical search terms. Return ONLY valid JSON — no markdown, no code fences:

{
  "englishTranslation": "English translation of the full query",
  "technicalConcepts": ["extracted technical concepts as English terms", "e.g. ci-cd, monitoring, container"],
  "alternativeQueries": ["2-3 alternative English search phrases", "approaching the same need from different angles"]
}

JSON:`;

    try {
      const raw = await this.ollama.generate(prompt, this.model, signal);
      const parsed = this.parseJson<{
        englishTranslation?: string;
        technicalConcepts?: string[];
        alternativeQueries?: string[];
      }>(raw);

      return {
        translation: parsed.englishTranslation ?? query,
        concepts: parsed.technicalConcepts ?? [],
        alternatives: parsed.alternativeQueries ?? [],
      };
    } catch {
      // LLM failure: fall back to local translation only
      return null;
    }
  }

  /**
   * Build the final set of search variants from original query, translation,
   * concepts, and alternatives. Deduplicates and limits to useful variants.
   */
  private buildSearchVariants(
    originalQuery: string,
    englishTranslation: string,
    technicalConcepts: string[],
    alternatives: string[],
  ): string[] {
    const variants: string[] = [];
    const seen = new Set<string>();

    const add = (v: string) => {
      const normalized = v.toLowerCase().trim().replace(/\s+/g, ' ');
      if (normalized.length >= 2 && !seen.has(normalized)) {
        seen.add(normalized);
        variants.push(v.trim());
      }
    };

    // 1. Original Vietnamese query (for exact match on Vietnamese-named repos)
    add(originalQuery);

    // 2. English translation (primary variant)
    add(englishTranslation);

    // 3. Technical concepts as compact query
    if (technicalConcepts.length > 0) {
      add(technicalConcepts.slice(0, 4).join(' '));
    }

    // 4. Alternative queries
    for (const alt of alternatives.slice(0, 3)) {
      add(alt);
    }

    return variants.slice(0, 5); // Cap at 5 variants
  }

  private mergeUnique(...arrays: string[][]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const arr of arrays) {
      for (const item of arr) {
        const lower = item.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          result.push(item);
        }
      }
    }
    return result;
  }

  private parseJson<T>(raw: string): T {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```(?:json)?\s*/g, '').trim();
    }
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]) as T;
      }
      throw new Error(`Failed to parse LLM output as JSON. Raw: ${raw.slice(0, 200)}`);
    }
  }
}

// ── Translation Cache ──

export interface CachedTranslation {
  originalQuery: string;
  englishTranslation: string;
  searchVariants: string[];
  technicalConcepts: string[];
}

export interface TranslationCacheMetrics {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
}

const TRANSLATION_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TRANSLATION_CACHE_SIZE = 200;

/**
 * TTL + LRU cache for Vietnamese→English translations.
 * Avoids repeated LLM calls for the same query.
 */
export class VietnameseTranslationCache {
  private cache = new Map<string, { entry: CachedTranslation; timestamp: number }>();
  private _hits = 0;
  private _misses = 0;

  static key(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  get(key: string): CachedTranslation | null {
    const normalizedKey = VietnameseTranslationCache.key(key);
    const entry = this.cache.get(normalizedKey);
    if (!entry) {
      this._misses++;
      return null;
    }
    if (Date.now() - entry.timestamp > TRANSLATION_CACHE_TTL_MS) {
      this.cache.delete(normalizedKey);
      this._misses++;
      return null;
    }
    // LRU touch
    this.cache.delete(normalizedKey);
    this.cache.set(normalizedKey, entry);
    this._hits++;
    return entry.entry;
  }

  set(key: string, translation: CachedTranslation): void {
    const normalizedKey = VietnameseTranslationCache.key(key);
    if (this.cache.size >= MAX_TRANSLATION_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(normalizedKey, { entry: translation, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  getMetrics(): TranslationCacheMetrics {
    return {
      hits: this._hits,
      misses: this._misses,
      size: this.cache.size,
      maxSize: MAX_TRANSLATION_CACHE_SIZE,
    };
  }

  resetMetrics(): void {
    this._hits = 0;
    this._misses = 0;
  }
}

/** Singleton translation cache instance */
export const translationCache = new VietnameseTranslationCache();

// ── Vietnamese Refinement Detection ──

/**
 * Vietnamese refinement phrase patterns and their English equivalents
 * for the RefinementParser. These are local (non-LLM) translations.
 */
export const VIETNAMESE_REFINEMENTS: Record<string, { english: string; type: 'emphasis' | 'raw-sort'; emphasis?: import('../../shared/types').WeightEmphasis; sortKey?: 'stars' | 'updated_at' | 'forks'; sortDesc?: boolean }> = {
  // Language preferences
  'ưu tiên go': { english: 'prefer Go', type: 'emphasis', emphasis: { semanticMatch: 1.5, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 3.0, licenseCompatibility: 1.0 } },
  'ưu tiên rust': { english: 'prefer Rust', type: 'emphasis', emphasis: { semanticMatch: 1.5, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 3.0, licenseCompatibility: 1.0 } },
  'ưu tiên python': { english: 'prefer Python', type: 'emphasis', emphasis: { semanticMatch: 1.5, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 3.0, licenseCompatibility: 1.0 } },
  'ưu tiên typescript': { english: 'prefer TypeScript', type: 'emphasis', emphasis: { semanticMatch: 1.5, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 3.0, licenseCompatibility: 1.0 } },

  // Domain preferences
  'thiên về devops': { english: 'more DevOps', type: 'emphasis', emphasis: { semanticMatch: 2.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.5, languageMatch: 1.0, licenseCompatibility: 1.0 } },
  'thiên về backend': { english: 'more backend', type: 'emphasis', emphasis: { semanticMatch: 2.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.5, languageMatch: 1.0, licenseCompatibility: 1.0 } },

  // Negative adjustments
  'ít kubernetes hơn': { english: 'less Kubernetes', type: 'emphasis', emphasis: { semanticMatch: 0.5, starsScore: 1.5, activityScore: 1.5, readmeRelevance: 1.0, languageMatch: 1.5, licenseCompatibility: 1.0 } },
  'ít docker hơn': { english: 'less Docker', type: 'emphasis', emphasis: { semanticMatch: 0.5, starsScore: 1.5, activityScore: 1.5, readmeRelevance: 1.0, languageMatch: 1.5, licenseCompatibility: 1.0 } },

  // License preferences
  'chỉ mã nguồn mở': { english: 'open source only', type: 'emphasis', emphasis: { semanticMatch: 1.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 1.0, licenseCompatibility: 3.0 } },
  'giấy phép mit': { english: 'MIT license', type: 'emphasis', emphasis: { semanticMatch: 1.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 1.0, licenseCompatibility: 3.0 } },

  // Deployment preferences
  'hỗ trợ docker': { english: 'Docker support', type: 'emphasis', emphasis: { semanticMatch: 2.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.5, languageMatch: 1.0, licenseCompatibility: 1.0 } },
  'tự host': { english: 'self-hosted', type: 'emphasis', emphasis: { semanticMatch: 2.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.5, languageMatch: 1.0, licenseCompatibility: 1.0 } },
};

/**
 * Checks if a refinement text contains Vietnamese, and if so, maps it
 * to a DetectedRefinement using local patterns. Returns null if no
 * Vietnamese refinement is detected (caller should try other parsers).
 */
export function detectVietnameseRefinement(text: string): import('./refinement-parser').DetectedRefinement | null {
  const lower = text.toLowerCase().trim();

  // Direct Vietnamese refinement pattern matches
  for (const [viPhrase, mapping] of Object.entries(VIETNAMESE_REFINEMENTS)) {
    if (lower.includes(viPhrase)) {
      if (mapping.type === 'raw-sort') {
        return {
          type: 'raw-sort',
          sortKey: mapping.sortKey,
          sortDesc: mapping.sortDesc ?? true,
        };
      }
      return {
        type: 'emphasis',
        emphasis: mapping.emphasis!,
      };
    }
  }

  // Vietnamese language preference patterns: "ưu tiên X", "chỉ X"
  const langPrefMatch = lower.match(/ưu\s+tiên\s+(\w+)/);
  if (langPrefMatch) {
    const lang = langPrefMatch[1];
    const knownLangs: Record<string, string> = {
      'go': 'go', 'golang': 'go', 'rust': 'rust', 'python': 'python',
      'java': 'java', 'typescript': 'typescript', 'javascript': 'javascript',
      'kotlin': 'kotlin', 'swift': 'swift', 'ruby': 'ruby', 'php': 'php',
      'c++': 'c++', 'c#': 'c#',
    };
    const canonical = knownLangs[lang];
    if (canonical) {
      return {
        type: 'emphasis',
        emphasis: { semanticMatch: 1.5, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 3.0, licenseCompatibility: 1.0 },
      };
    }
  }

  // Vietnamese "chỉ mã nguồn mở" or "giấy phép X"
  if (lower.includes('mã nguồn mở') || lower.includes('mã nguồn mở')) {
    return {
      type: 'emphasis',
      emphasis: { semanticMatch: 1.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 1.0, licenseCompatibility: 3.0 },
    };
  }

  // Vietnamese sort patterns
  if (lower.includes('nhiều sao nhất') || lower.includes('phổ biến nhất')) {
    return { type: 'raw-sort', sortKey: 'stars', sortDesc: true };
  }
  if (lower.includes('mới nhất') || lower.includes('cập nhật gần đây')) {
    return { type: 'raw-sort', sortKey: 'updated_at', sortDesc: true };
  }

  return null;
}