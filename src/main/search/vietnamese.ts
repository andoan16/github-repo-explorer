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

  // Quick reject: check the most distinctive Vietnamese characters first.
  // Covers ơ ư ă đ and Latin Extended Additional (ả ấ ầ etc.) — chars that
  // almost never appear in non-Vietnamese text. This skips the full 17-regex
  // scan for ~99% of English/other-language queries.
  const VIET_QUICK_CHECK = /[ăơưđ\u1EA0-\u1EFF]/i;
  if (!VIET_QUICK_CHECK.test(text)) {
    // Also check basic accent ranges — if none, definitely not Vietnamese
    const BASIC_ACCENT = /[\u00C0-\u00FF\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0]/;
    if (!BASIC_ACCENT.test(text)) return 0;
  }

  // Full scan for scoring
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
  'phân tán': ['distributed', 'cluster'],
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
  'mã hóa': ['encryption', 'crypto', 'tls'],
  'chứng thực': ['authentication', 'auth', 'login'],
  'phân quyền': ['authorization', 'rbac', 'permissions'],
  'an toàn': ['security', 'safety'],

  // ── Data / Database ──
  'cơ sở dữ liệu': ['database', 'db'],
  'dữ liệu': ['data'],
  'kho dữ liệu': ['data warehouse', 'data-warehouse'],
  'sao lưu': ['backup', 'backup-restore'],
  'khôi phục': ['recovery', 'disaster-recovery'],
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

  // ── AI / ML (was missing) ──
  'trí tuệ nhân tạo': ['artificial intelligence', 'ai'],
  'học máy': ['machine learning', 'ml'],
  'học sâu': ['deep learning'],
  'mô hình ngôn ngữ': ['language model', 'llm'],
  'xử lý ngôn ngữ tự nhiên': ['nlp', 'natural language processing'],
  'thị giác máy tính': ['computer vision'],
  'tạo sinh': ['generative', 'generative-ai'],
  'huấn luyện': ['training', 'train'],
  'suy luận': ['inference'],
  'mô hình': ['model'],

  // ── Web / Mobile (was missing) ──
  'trang web': ['website', 'web'],
  'ứng dụng web': ['web app', 'web-application'],
  'ứng dụng di động': ['mobile app', 'mobile'],
  'giao diện dòng lệnh': ['cli', 'command-line'],
  'giao diện người dùng': ['ui', 'user-interface'],
  'giao diện lập trình': ['api', 'rest-api'],

  // ── Common modifiers (was missing) ──
  'nhẹ': ['lightweight'],
  'nhanh': ['fast', 'high-performance'],
  'mạnh mẽ': ['powerful'],
  'đơn giản': ['simple', 'minimal'],
  'ổn định': ['stable', 'reliable'],
  'phổ biến': ['popular'],
  'miễn phí': ['free', 'open-source'],
  'mới nhất': ['latest', 'newest'],
  'thay thế': ['alternative', 'replace'],
  'giải pháp': ['solution'],
  'chạy': ['run', 'runner', 'execute'],

  // ── Infrastructure (was missing) ──
  'hạ tầng': ['infrastructure', 'infra'],
  'cung cấp': ['provisioning'],
  'điều phối': ['orchestration'],
  'vùng chứa': ['container', 'docker'],
  'phục hồi': ['recovery', 'restore'],
  'tự quản lý': ['self-hosted', 'self-managed'],
  'tại chỗ': ['on-premise', 'self-hosted'],

  // ── Workflow / Security (was missing) ──
  'quy trình': ['workflow', 'pipeline'],
  'tự động hóa': ['automation'],
  'cảnh báo': ['alerting', 'alert'],
  'đo lường': ['metrics'],
  'tường lửa ứng dụng': ['waf', 'web-application-firewall'],
  'quét lỗ hổng': ['vulnerability scanner', 'security-scanner'],

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
  // Intent-carrying alternatives for generic Vietnamese→English mappings.
  // Generic-only terms (system, platform, tool) are filtered by ENGLISH_GENERIC_TERMS,
  // so compound entries provide the domain-specific search terms that survive filtering.
  'công cụ': ['devops-tool', 'cli-tool'],
  'nền tảng': ['platform', 'framework'],
  'hệ thống': ['system', 'infra'],
  'trình': ['runner', 'engine'],
  'quản lý': ['management', 'admin'],
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
  // ── Newly added vocabulary for broader coverage ──
  'chạy thử': ['testing', 'test'],
  'biến số': ['variable', 'env'],
  'môi trường': ['environment', 'env'],
  'đăng nhập': ['login', 'authentication'],
  'tải xuống': ['download', 'installer'],
  'cập nhật': ['update', 'upgrade', 'release'],
  'phiên bản mới': ['latest', 'release'],
  'lỗi': ['bug', 'error', 'issue'],
  'sửa lỗi': ['bugfix', 'patch'],
  'hiệu suất': ['performance', 'benchmark'],
  'quy mô': ['scale', 'scaling'],
  'đồng bộ': ['sync', 'synchronization'],
  'ảnh': ['image', 'container-image'],
  'máy chủ ảo': ['virtual-machine', 'vm'],
  'nút': ['node', 'cluster-node'],
  'kiểm tra': ['check', 'validate', 'verify'],
  'chuyển đổi': ['convert', 'transform', 'migration'],
  'trang quản trị': ['admin-panel', 'dashboard'],
  'bảo trì': ['maintenance', 'ops'],
  'thử nghiệm': ['experiment', 'testing'],
  // ── Additional high-ROI compounds: domain-specific intent carriers ──
  // These map commonly used Vietnamese phrases to their precise English domain
  // equivalents, improving both Phase 1 keyword generation and ranking relevance.
  'máy chủ email': ['mail-server', 'smtp'],
  'chứng chỉ ssl': ['ssl-certificate', 'tls'],
  'quét mã nguồn': ['code-scanning', 'sast'],
  'tối ưu hiệu suất': ['performance-optimization', 'profiling'],
  'chạy container': ['container-runtime', 'docker'],
  'kiểm soát phiên bản': ['version-control', 'git'],
  'mô hình phân tích': ['analytics-engine', 'data-pipeline'],
  'xác thực hai yếu tố': ['2fa', 'mfa'],
  'quản lý cấu hình': ['config-management', 'infrastructure-as-code'],
  'quy trình làm việc': ['workflow-engine', 'automation'],

  // ── Additional high-ROI entries: common Vietnamese developer search terms ──
  // These address gaps where the local translator would previously drop the word
  // or emit a poor romanization instead of the correct English domain term.

  // ── Version control / collaboration ──
  'quản lý mã nguồn': ['version-control', 'git', 'scm'],
  'kho mã nguồn': ['code-repository', 'git-repo'],
  'hợp tác lập trình': ['collaborative-coding', 'code-review'],

  // ── Database / data engineering (commonly used but missing) ──
  'cơ sở dữ liệu quan hệ': ['relational-database', 'sql'],
  'cơ sở dữ liệu phi quan hệ': ['nosql', 'document-database'],
  'mô hình dữ liệu': ['data-model', 'orm'],
  'đồng bộ dữ liệu': ['data-sync', 'replication'],
  'xử lý dữ liệu lớn': ['big-data', 'data-engineering'],

  // ── Messaging / communication ──
  'máy chủ chat': ['chat-server', 'messaging'],
  'nhắn tin tức thời': ['instant-messaging', 'realtime-chat'],

  // ── Monitoring / SRE ──
  'phát hiện sự cố': ['incident-detection', 'alerting'],
  'quản lý sự cố': ['incident-management', 'pagerduty'],
  'bảng trạng thái': ['status-page', 'uptime-monitor'],

  // ── Container / orchestration ──
  'quản lý container': ['container-management', 'container-orchestration'],
  'đăng ký container': ['container-registry', 'docker-registry'],

  // ── Network / proxy ──
  'proxy đảo ngược': ['reverse-proxy', 'load-balancer'],
  'máy chủ dns': ['dns-server'],

  // ── File / object storage ──
  'lưu trữ đối tượng': ['object-storage', 's3'],
  'chia sẻ tệp': ['file-sharing', 'cloud-storage'],

  // ── Auth / identity ──
  'quản lý định danh': ['identity-management', 'idp'],
  'đăng nhập một lần': ['sso', 'single-sign-on'],

  // ── Additional high-ROI Vietnamese developer search terms ──
  'tối ưu': ['optimization', 'optimized'],
  'tối ưu hóa': ['optimization', 'performance-tuning'],
  'máy chủ web': ['web-server', 'http-server'],
  'báo cáo lỗi': ['issue-tracker', 'bug-tracker'],
  'kiểm soát truy cập': ['access-control', 'rbac'],
  'phiên bản hóa': ['versioning', 'git'],
  'máy chủ tệp': ['file-server', 'nas'],
  'cổng api': ['api-gateway', 'rest-api'],
  'máy chủ proxy': ['proxy-server', 'reverse-proxy'],
  'quét bảo mật': ['security-scanning', 'vulnerability-scan'],
  'mã nguồn đóng': ['proprietary', 'closed-source'],
  'hiệu suất cao': ['high-performance', 'fast', 'optimized'],
  'chạy thử nghiệm': ['staging', 'preview'],
  'mở rộng': ['scaling', 'horizontal-scaling'],
  'thu nhỏ': ['micro', 'lightweight', 'minimal'],
  'tích hợp hệ thống': ['system-integration', 'integration'],
  'chạy song song': ['parallel', 'concurrency'],
  'biên tập mã': ['code-editor', 'ide'],
  'trình thông dịch': ['interpreter', 'runtime'],
  'thư mục': ['directory', 'folder'],
  'cài đặt': ['install', 'setup'],
  'cấu hình máy chủ': ['server-config', 'infrastructure-as-code'],
  'triển khai tự động': ['auto-deploy', 'continuous-deployment'],
  'kiểm tra tự động': ['automated-testing', 'ci'],
  'chế độ tối': ['dark-mode', 'theme'],
  'xác minh': ['verification', 'validation'],
  'quản lý gói': ['package-manager', 'package-management'],
  'bảo trì dự đoán': ['predictive-maintenance', 'monitoring'],
  'máy chủ tàng hình': ['stealth-server', 'privacy'],
  'sao chép dữ liệu': ['data-replication', 'backup'],
  // ── High-ROI additions: common Vietnamese developer queries missing from dict ──
  'tin nhắn': ['messaging', 'chat', 'notification'],
  'nhắn tin': ['messaging', 'instant-messaging', 'chat'],
  'dự án': ['project', 'project-management'],
  'quản lý dự án': ['project-management', 'kanban'],
  'hệ thống nhắn tin': ['messaging-system', 'chat'],
  'hàng đợi': ['queue', 'message-queue'],
  'luồng': ['thread', 'stream'],
  'sự kiện': ['event', 'event-driven'],
  'vô trạng thái': ['stateless'],
  'có trạng thái': ['stateful'],
  'cập nhật liên tục': ['continuous-deployment', 'rolling-update'],
  'truy xuất nguồn gốc': ['traceability', 'provenance'],
  'chấm điểm': ['scoring', 'rating'],
  'thu thập': ['collection', 'harvesting'],
  'trích xuất': ['extraction', 'etl'],
  'hợp nhất': ['merge', 'consolidation'],
  'loại bỏ': ['removal', 'cleanup'],
  'định tuyến': ['routing', 'router'],
  'phân phối': ['distribution', 'cdn'],
  'mở khóa': ['unlock', 'release'],
  'khóa': ['lock', 'encryption'],
  'phím tắt': ['shortcut', 'hotkey'],
  'giao thức': ['protocol'],
  'di chuyển': ['migration', 'transfer'],
  'thống nhất': ['unified', 'consolidated'],
  'quay lại': ['rollback', 'undo'],
};

/**
 * Common Vietnamese words that should be stripped as stop-words during
 * English query generation (they don't add search value in English context).
 */
export const VIETNAMESE_STOP_WORDS = new Set([
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
    precomputedConfidence?: number,
  ): Promise<MultilingualExpansion | null> {
    // Use pre-computed confidence if available to avoid redundant detectVietnamese() call
    const confidence = precomputedConfidence ?? detectVietnamese(userQuery);
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

    // Phase 2: LLM-powered translation — skip if local dictionary has high coverage
    // This saves ~3-10s of LLM latency for queries the dictionary fully covers.
    let llmEnhancement: { translation: string; concepts: string[]; alternatives: string[] } | null = null;
    const localCoverage = this.computeCoverage(userQuery, localResult);
    if (this.ollama && this.model && localCoverage < 0.8) {
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
    const maxPhraseLen = 7; // longest phrase in dictionary is 7 words ("cơ sở dữ liệu phi quan hệ")
    let i = 0;
    const usedIndices = new Set<number>();

    while (i < words.length) {
      let matched = false;

      // Try longest phrase first, then shorter
      for (let len = Math.min(maxPhraseLen, words.length - i); len >= 1; len--) {
        const phrase = words.slice(i, i + len).join(' ');

        if (VIETNAMESE_TECH_DICTIONARY[phrase]) {
          const translations = VIETNAMESE_TECH_DICTIONARY[phrase];
          // Filter generic English terms from primary translation (e.g., "system", "tool")
          const primary = translations[0].toLowerCase();
          if (!ENGLISH_GENERIC_TERMS.has(primary)) {
            translatedParts.push(translations[0]);
          }
          // Collect all translations as concepts (skip generic terms)
          for (const t of translations) {
            if (!ENGLISH_GENERIC_TERMS.has(t.toLowerCase()) && !concepts.includes(t)) {
              concepts.push(t);
            }
          }
          for (let j = i; j < i + len; j++) usedIndices.add(j);
          matched = true;
          i += len;
          break;
        }
      }

      if (!matched) {
        // Check if it's a stop word or a technical term
        const word = words[i];
        if (VIETNAMESE_STOP_WORDS.has(word)) {
          i++;
          continue;
        }
        if (!/[ăơưâêôđ\u00C0-\u00FF\u1EA0-\u1EFF]/.test(word) && word.length >= 2) {
          // English/tech word with no Vietnamese diacritics — pass through
          translatedParts.push(word);
        } else if (word.length >= 2) {
          // Vietnamese word not in dictionary — strip diacritics as fallback.
          // "quyền" → "quyen" is better than dropping entirely; GitHub may
          // match repos with this romanized form in descriptions.
          const stripped = normalizeDiacritics(word);
          if (stripped.length >= 2) {
            translatedParts.push(stripped);
          }
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

    // Build additional variants by substituting secondary dictionary translations.
    // E.g., if "quản lý" → ["manage", "management", "admin"], produce variants
    // replacing "manage" with "management" and "admin" in the translation.
    // This broadens GitHub search recall for synonym-rich terms.
    const secondaryVariants = this.buildSecondaryVariants(translatedParts, usedIndices, words);
    for (const sv of secondaryVariants) {
      variants.push(sv);
    }

    return { translation, concepts, variants };
  }

  /**
   * Produce variant translations by substituting secondary dictionary entries
   * into the translated parts. For each position where a dictionary match produced
   * multiple translations, create variants using each alternative translation.
   */
  private buildSecondaryVariants(
    translatedParts: string[],
    usedIndices: Set<number>,
    originalWords: string[],
  ): string[] {
    const variants: string[] = [];
    // Re-walk the original words to find dict entries with multiple translations
    let i = 0;
    let partIdx = 0;
    const maxPhraseLen = 7;

    while (i < originalWords.length) {
      let matched = false;

      for (let len = Math.min(maxPhraseLen, originalWords.length - i); len >= 1; len--) {
        const phrase = originalWords.slice(i, i + len).join(' ');
        const translations = VIETNAMESE_TECH_DICTIONARY[phrase];
        if (translations && translations.length > 1) {
          // This entry has secondary translations — produce variants
          for (let t = 1; t < translations.length && variants.length < 3; t++) {
            const variant = [...translatedParts];
            variant[partIdx] = translations[t]; // swap in the alternative
            variants.push(variant.join(' '));
          }
          partIdx++;
          i += len;
          matched = true;
          break;
        }
        if (translations && translations.length === 1) {
          partIdx++;
          i += len;
          matched = true;
          break;
        }
      }

      if (!matched) {
        const word = originalWords[i];
        if (!VIETNAMESE_STOP_WORDS.has(word) && word.length >= 2) {
          partIdx++;
        }
        i++;
      }
    }

    return variants.slice(0, 3); // Cap at 3 secondary variants
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
      const raw = await this.ollama.generate(prompt, this.model, signal, 512);
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

  /**
   * Compute what fraction of *Vietnamese* query words were translated by the
   * local dictionary. Returns 0-1 where 1.0 = every Vietnamese word was handled.
   *
   * IMPORTANT: Only counts Vietnamese words (those with diacritics or matching
   * dictionary keys) in the denominator. English pass-through words are excluded
   * to avoid inflating coverage — a query like "Công cụ ETL chạy on-premise"
   * should not count "ETL" and "on-premise" as "covered" just because they
   * pass through unchanged.
   */
  private computeCoverage(query: string, localResult: { translation: string; concepts: string[]; variants: string[] }): number {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2 && !VIETNAMESE_STOP_WORDS.has(w));
    if (words.length === 0) return 1;

    // Determine which words are Vietnamese (require translation)
    // A word is Vietnamese if it contains diacritics OR matches a dictionary key
    const dictKeysLower = new Set(Object.keys(VIETNAMESE_TECH_DICTIONARY).map(k => k.toLowerCase()));
    const hasDiacritics = (w: string) => /[ăơưâêôđ\u1EA0-\u1EFF\u00C0-\u00FF\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0]/i.test(w);

    const vietnameseWords = words.filter(w => hasDiacritics(w) || dictKeysLower.has(w));
    if (vietnameseWords.length === 0) return 1; // no Vietnamese words to translate

    // Check which Vietnamese words were covered by local translation
    const translated = new Set(localResult.concepts.map(c => c.toLowerCase()));
    const translationWords = localResult.translation.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    for (const tw of translationWords) translated.add(tw);

    let covered = 0;
    for (const w of vietnameseWords) {
      // Check if the word, or a phrase containing it, was translated
      const dictEntry = VIETNAMESE_TECH_DICTIONARY[w];
      if (dictEntry) {
        covered++; // directly matched a dictionary key
      } else if (translated.has(w)) {
        covered++; // word appears in translation output
      }
    }
    return covered / vietnameseWords.length;
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
    // Caller already normalizes via VietnameseTranslationCache.key() —
    // skip redundant re-normalization for performance
    const normalizedKey = key.includes(' ') || key !== key.toLowerCase()
      ? VietnameseTranslationCache.key(key)
      : key;  // already normalized
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

// ── Quick Vietnamese Translation for Phase 1 ──

/**
 * Strips Vietnamese diacritics from text, producing an ASCII-safe version
 * that matches better against GitHub's search index (which normalizes
 * diacritics inconsistently). For example, "quản lý" → "quan ly".
 */
export function normalizeDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Strip combining marks
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Structured result from quickVietnameseTranslate containing the translation
 * and additional enrichment data for Phase 1 search without LLM calls.
 */
export interface QuickVietnameseResult {
  /** English translation suitable for GitHub search */
  translation: string;
  /** Technical concepts extracted from the query (e.g., "docker", "ci-cd") */
  techTerms: string[];
  /** GitHub-search-friendly synonym expansions beyond the primary translation */
  expandedKeywords: string[];
  /** Best-guess intent slug (e.g., "devops-tool", "security-tool") or null */
  intent: string | null;
}

/**
 * Quick local-only Vietnamese→English translation for Phase 1 fast-keyword path.
 * No LLM call — pure dictionary lookup. Returns the English translation plus
 * enrichment data (tech terms, synonym expansions, intent), or null if the text
 * is not Vietnamese or no meaningful translation can be produced.
 *
 * This fixes the Phase 1 zero-recall bug: without it, Vietnamese queries sent
 * raw to GitHub API produce zero results because Vietnamese function words
 * become mandatory match terms.
 *
 * @param text Vietnamese query text
 * @returns Structured result with translation + enrichment, or null if not Vietnamese
 */
/**
 * English terms that are too generic to be useful in GitHub search queries.
 * Dictionary entries may map to these, but they should be filtered from
 * translatedParts and concepts because they produce false-positive matches
 * in the ranking engine (e.g., "only" matches repos with "only" in their
 * description, "support" matches almost everything).
 */
export const ENGLISH_GENERIC_TERMS = new Set([
  'only', 'less', 'fewer', 'just', 'also', 'more', 'much', 'very',
  'many', 'some', 'each', 'every', 'most', 'well', 'able', 'like',
  // Generic nouns commonly produced by Vietnamese→English dictionary mapping.
  // These match too many repos in GitHub search and dilute ranking relevance.
  'system', 'platform', 'tool', 'support', 'service', 'solution',
  'application', 'software', 'runner', 'engine', 'manager',
]);

export function quickVietnameseTranslate(text: string): string | null {
  const structured = quickVietnameseTranslateStructured(text);
  return structured ? structured.translation : null;
}

/**
 * Full structured version of quickVietnameseTranslate that returns tech terms,
 * synonym expansions, and intent classification in addition to the translation.
 * Used by callers that need enrichment data for Phase 1 search.
 */
export function quickVietnameseTranslateStructured(text: string): QuickVietnameseResult | null {
  const confidence = detectVietnamese(text);
  if (confidence < 0.3) return null;

  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 0);

  const translatedParts: string[] = [];
  const concepts: string[] = [];

  // Sliding window: try multi-word matches first (longest phrases most specific)
  const maxPhraseLen = 7; // longest phrase in dictionary is 7 words
  let i = 0;

  while (i < words.length) {
    let matched = false;

    for (let len = Math.min(maxPhraseLen, words.length - i); len >= 1; len--) {
      const phrase = words.slice(i, i + len).join(' ');
      const dictEntry = VIETNAMESE_TECH_DICTIONARY[phrase];
      if (dictEntry) {
        // Use primary translation for the query string (skip if generic)
        const primary = dictEntry[0].toLowerCase();
        if (!ENGLISH_GENERIC_TERMS.has(primary)) {
          translatedParts.push(dictEntry[0]);
        }
        // Collect all translations (including secondary) as concepts
        // (skip generic terms — they match too many repos)
        for (const t of dictEntry) {
          if (!ENGLISH_GENERIC_TERMS.has(t.toLowerCase()) && !concepts.includes(t)) concepts.push(t);
        }
        matched = true;
        i += len;
        break;
      }
    }

    if (!matched) {
      const word = words[i];
      // Skip Vietnamese stop words — they add zero search value in English
      if (VIETNAMESE_STOP_WORDS.has(word)) {
        i++;
        continue;
      }
      // Pass through English/tech words (no diacritics)
      if (!/[ăơưâêôđ\u00C0-\u00FF\u1EA0-\u1EFF]/.test(word) && word.length >= 2) {
        translatedParts.push(word);
      } else if (word.length >= 2) {
        // Vietnamese word not in dictionary — strip diacritics as a fallback.
        // "quyền" → "quyen" is better than dropping the word entirely; GitHub
        // may still match repos with this romanized form in descriptions.
        const stripped = normalizeDiacritics(word);
        if (stripped.length >= 2) {
          translatedParts.push(stripped);
        }
      }
      i++;
    }
  }

  if (translatedParts.length === 0) return null;
  const translation = translatedParts.join(' ');

  // Extract tech terms from the original text (e.g., "docker", "kubernetes")
  const techTerms = extractTechTerms(text);

  // Expand synonyms from VIETNAMESE_GITHUB_SYNONYMS
  const originalLower = text.toLowerCase();
  const expandedKeywords = expandGithubSynonyms(originalLower, translatedParts);

  // Classify intent from Vietnamese patterns
  const intent = classifyVietnameseIntent(text);

  return {
    translation,
    techTerms,
    expandedKeywords,
    intent,
  };
}

// ── Technology / entity extraction from Vietnamese queries ──

/**
 * Well-known technology terms that commonly appear in Vietnamese queries
 * (mixed Vietnamese-English). These are extracted as-is for search keywords,
 * since they are the exact GitHub-recognized terms.
 */
const TECH_TERMS: Record<string, string[]> = {
  'docker': ['docker', 'containerization'],
  'kubernetes': ['kubernetes', 'k8s'],
  'k8s': ['kubernetes', 'k8s'],
  'ci/cd': ['ci-cd', 'continuous-integration'],
  'ci-cd': ['ci-cd', 'continuous-integration'],
  'cicd': ['ci-cd', 'continuous-integration'],
  'react': ['react', 'frontend'],
  'vue': ['vue', 'frontend'],
  'angular': ['angular', 'frontend'],
  'node': ['nodejs', 'node'],
  'nodejs': ['nodejs', 'node'],
  'python': ['python'],
  'golang': ['go', 'golang'],
  'rust': ['rust'],
  'mongodb': ['mongodb', 'database'],
  'postgresql': ['postgresql', 'database'],
  'postgres': ['postgresql', 'database'],
  'redis': ['redis', 'cache'],
  'nginx': ['nginx', 'web-server'],
  'terraform': ['terraform', 'infrastructure-as-code'],
  'git': ['git', 'version-control'],
  'linux': ['linux'],
  'rest': ['rest-api'],
  'graphql': ['graphql', 'api'],
  'api': ['api', 'rest-api'],
  'ml': ['machine-learning', 'ml'],
  'ai': ['artificial-intelligence', 'ai'],
  'llm': ['llm', 'language-model'],
  // ── Commonly appear in Vietnamese queries ──
  'typescript': ['typescript', 'frontend'],
  'javascript': ['javascript', 'frontend'],
  'java': ['java', 'backend'],
  'jenkins': ['jenkins', 'ci-cd'],
  'gitlab': ['gitlab', 'ci-cd'],
  'ansible': ['ansible', 'automation'],
  'elasticsearch': ['elasticsearch', 'search-engine'],
  'kafka': ['kafka', 'message-queue'],
  'rabbitmq': ['rabbitmq', 'message-queue'],
  'prometheus': ['prometheus', 'monitoring'],
  'grafana': ['grafana', 'monitoring'],
  'mysql': ['mysql', 'database'],
  'sqlite': ['sqlite', 'database'],
  'mariadb': ['mariadb', 'database'],
  'svelte': ['svelte', 'frontend'],
  'next.js': ['nextjs', 'frontend'],
  'nextjs': ['nextjs', 'frontend'],
  'express': ['express', 'backend'],
  'django': ['django', 'backend'],
  'flask': ['flask', 'backend'],
  'spring': ['spring', 'backend'],
  'flutter': ['flutter', 'mobile'],
  'react native': ['react-native', 'mobile'],
  'swift': ['swift', 'mobile'],
  'kotlin': ['kotlin', 'backend'],
  'argo': ['argo', 'ci-cd'],
  'helm': ['helm', 'kubernetes'],
  'vault': ['vault', 'secrets'],
  'consul': ['consul', 'service-discovery'],
  'tailscale': ['tailscale', 'vpn'],
  'traefik': ['traefik', 'proxy'],
  'caddy': ['caddy', 'web-server'],
  'apache': ['apache', 'web-server'],
  'hadoop': ['hadoop', 'big-data'],
  'spark': ['spark', 'big-data'],
  'airflow': ['airflow', 'workflow'],
  'vscode': ['vscode', 'editor'],
  // ── Additional high-ROI tech terms commonly seen in Vietnamese queries ──
  'copilot': ['copilot', 'ai-assistant'],
  'supabase': ['supabase', 'backend-as-a-service'],
  'firebase': ['firebase', 'backend-as-a-service'],
  'vercel': ['vercel', 'hosting'],
  'netlify': ['netlify', 'hosting'],
  'heroku': ['heroku', 'paas'],
  'digitalocean': ['digitalocean', 'cloud'],
  'aws': ['aws', 'cloud'],
  'gcp': ['gcp', 'cloud'],
  'azure': ['azure', 'cloud'],
  'opentelemetry': ['opentelemetry', 'observability'],
  'datadog': ['datadog', 'monitoring'],
  'sentry': ['sentry', 'error-tracking'],
  'storybook': ['storybook', 'ui'],
  'tailwind': ['tailwind', 'css-framework'],
  'bootstrap': ['bootstrap', 'css-framework'],
  'meilisearch': ['meilisearch', 'search-engine'],
  'typesense': ['typesense', 'search-engine'],
  'minio': ['minio', 'object-storage'],
  'cloudflare': ['cloudflare', 'cdn'],
  'nuxt': ['nuxt', 'frontend'],
  'remix': ['remix', 'frontend'],
  'astro': ['astro', 'frontend'],
  'solid': ['solidjs', 'frontend'],
  'deno': ['deno', 'runtime'],
  'bun': ['bun', 'runtime'],
  'railway': ['railway', 'paas'],
  'render': ['render', 'paas'],
  'k3s': ['k3s', 'kubernetes'],
  'istio': ['istio', 'service-mesh'],
  'linkerd': ['linkerd', 'service-mesh'],
  'pgvector': ['pgvector', 'vector-database'],
  'chroma': ['chromadb', 'vector-database'],
  'pinecone': ['pinecone', 'vector-database'],
  'weaviate': ['weaviate', 'vector-database'],
  'qdrant': ['qdrant', 'vector-database'],
  'langchain': ['langchain', 'llm-framework'],
  'ollama': ['ollama', 'llm'],
  'litellm': ['litellm', 'llm'],
  'vllm': ['vllm', 'inference'],
  'webassembly': ['webassembly', 'wasm'],
  'wasm': ['webassembly', 'wasm'],
  'edge-computing': ['edge-computing', 'edge'],
  'strapi': ['strapi', 'cms'],
  'wordpress': ['wordpress', 'cms'],
  'ghost': ['ghost', 'cms'],
  'plausible': ['plausible', 'analytics'],
  'umami': ['umami', 'analytics'],
  'matomo': ['matomo', 'analytics'],
  'n8n': ['n8n', 'workflow-automation'],
  'temporal': ['temporal', 'workflow'],
  'dapr': ['dapr', 'microservices'],
  'jaeger': ['jaeger', 'tracing'],
  'zipkin': ['zipkin', 'tracing'],
  'etcd': ['etcd', 'key-value'],
  'cockroach': ['cockroachdb', 'database'],
  'tidb': ['tidb', 'database'],
  'scylla': ['scylladb', 'database'],
  'influxdb': ['influxdb', 'time-series'],
  'timescaledb': ['timescaledb', 'time-series'],

  // ── Additional tech terms commonly mixed into Vietnamese queries ──
  'gitea': ['gitea', 'git-server'],
  'forgejo': ['forgejo', 'git-server'],
  'woodpecker': ['woodpecker', 'ci-cd'],
  'drone': ['drone', 'ci-cd'],
  'act': ['act-runner', 'ci-cd'],
  'harbor': ['harbor', 'container-registry'],
  'portainer': ['portainer', 'docker-management'],
  'uptime': ['uptime-kuma', 'monitoring'],
  'glitchtip': ['glitchtip', 'error-tracking'],
  'zitadel': ['zitadel', 'identity'],
  'keycloak': ['keycloak', 'identity', 'sso'],
  'authentik': ['authentik', 'identity', 'sso'],
  'outline': ['outline', 'wiki'],
  'bookstack': ['bookstack', 'wiki'],
  'hedgedoc': ['hedgedoc', 'collaborative-editor'],
  'gotify': ['gotify', 'push-notification'],
  'unifi': ['unifi', 'network-management'],
  // ── Additional tech terms for Vietnamese mixed-language queries ──
  'sveltekit': ['sveltekit', 'frontend'],
  'htmx': ['htmx', 'frontend'],
  'alpine': ['alpinejs', 'frontend'],
  'memcached': ['memcached', 'cache'],
  'clickhouse': ['clickhouse', 'database', 'olap'],
  'lucene': ['lucene', 'search-engine'],
  'rabbit': ['rabbitmq', 'message-queue'],
  'sqlite3': ['sqlite', 'database'],
  'tailwindcss': ['tailwind', 'css-framework'],
  'pytorch': ['pytorch', 'deep-learning'],
  'tensorflow': ['tensorflow', 'deep-learning'],
  'onnx': ['onnx', 'inference'],
  'fastapi': ['fastapi', 'backend'],
  'nestjs': ['nestjs', 'backend'],
  'trpc': ['trpc', 'api'],
  'prisma': ['prisma', 'orm'],
  'typeorm': ['typeorm', 'orm'],
  'sequelize': ['sequelize', 'orm'],
  'drizzle': ['drizzle-orm', 'orm'],
  'supertest': ['supertest', 'testing'],
  'playwright': ['playwright', 'testing', 'e2e'],
  'vitest': ['vitest', 'testing'],
  'jest': ['jest', 'testing'],
  'cypress': ['cypress', 'testing', 'e2e'],
  'puppeteer': ['puppeteer', 'testing', 'browser-automation'],
};

/**
 * Extract technology/entity terms from a mixed Vietnamese-English query.
 * Returns canonical English tech terms found in the text (e.g., "docker" → "docker").
 * Pure function, no LLM call.
 */
export function extractTechTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  const seen = new Set<string>();

  for (const [term, expansions] of Object.entries(TECH_TERMS)) {
    // Use word-boundary-aware match so "script" doesn't match "typescript"
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match at word boundary or after /-+. for compound terms like ci/cd
    const pattern = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
    if (pattern.test(lower)) {
      for (const expansion of expansions) {
        if (!seen.has(expansion)) {
          seen.add(expansion);
          found.push(expansion);
        }
      }
    }
  }

  return found;
}

// ── Vietnamese → GitHub terminology expansion ──

/**
 * Maps Vietnamese technical terms to their GitHub-search-friendly synonyms.
 * When a Vietnamese query contains "quản lý", we also want to search for
 * "management" and "manager". This expansion runs in quickVietnameseTranslate()
 * and feeds into the search query pipeline without additional API calls.
 *
 * The goal: when the dict maps "quản lý" → ["management", "manager", "manage"],
 * the primary translation is "management" (used in the main query) and the
 * secondary terms "manager", "manage" become expanded keywords for broader recall.
 */
const VIETNAMESE_GITHUB_SYNONYMS: Record<string, string[]> = {
  // Primary Vietnamese compound terms → GitHub-friendly synonyms
  'quản lý': ['management', 'manager', 'admin'],
  'giám sát': ['monitoring', 'observability', 'watch'],
  'máy chủ': ['server', 'host'],
  'mật khẩu': ['password', 'credential', 'auth'],
  'cơ sở dữ liệu': ['database', 'db'],
  'bảo mật': ['security', 'secure'],
  'triển khai': ['deployment', 'deploy', 'release'],
  'tự động': ['automation', 'automated', 'auto'],
  'mã nguồn mở': ['open-source', 'oss'],
  'ứng dụng': ['app', 'application'],
  'giao diện': ['interface', 'ui', 'dashboard'],
  'xây dựng': ['build', 'ci'],
  'kiểm thử': ['testing', 'test'],
  'tự host': ['self-hosted', 'self-host'],
  'riêng tư': ['self-hosted', 'private'],
  'phân tích': ['analytics', 'analysis'],
  'thông báo': ['notification', 'alert', 'alerting'],
  'nhật ký': ['logging', 'logs'],
  'sao lưu': ['backup', 'backup-restore'],
  'huấn luyện': ['training', 'train'],
  'suy luận': ['inference'],
  'mã hóa': ['encryption', 'crypto', 'tls'],
  'chứng thực': ['authentication', 'auth', 'login'],
  'phân quyền': ['authorization', 'rbac', 'permissions'],
  'tích hợp': ['integration'],
  'điều phối': ['orchestration'],
  'cân bằng tải': ['load-balancer', 'load-balancing'],
  // ── Newly added synonym mappings ──
  'phát triển': ['development', 'dev'],
  'lập trình': ['programming', 'development', 'coding'],
  'thư viện': ['library', 'lib'],
  'khung': ['framework', 'lib'],
  'gỡ lỗi': ['debugging', 'debugger'],
  'biên dịch': ['compiler', 'compilation'],
  'hạ tầng': ['infrastructure', 'infra'],
  'bảng điều khiển': ['dashboard', 'control-panel', 'admin'],
  'tác nhân': ['agent', 'bot'],
  'nhắc nhở': ['reminder', 'notification'],
  'tìm kiếm': ['search', 'search-engine'],
  'cộng đồng': ['community', 'open-source'],
  'thống kê': ['statistics', 'analytics', 'metrics'],
  'trực quan': ['visualization', 'dashboard'],
  'đóng gói': ['packaging', 'package', 'bundle'],
  'nhanh': ['fast', 'high-performance', 'performance'],
  'nhẹ': ['lightweight', 'minimal', 'micro'],
  'ổn định': ['stable', 'reliable', 'production-ready'],
  'mới nhất': ['latest', 'newest', 'modern'],
  'thay thế': ['alternative', 'replacement', 'migration'],
  'giải pháp': ['solution', 'platform'],
  'quy trình': ['workflow', 'pipeline', 'automation'],
  'tự động hóa': ['automation', 'automated', 'ci'],
  // ── Additional high-ROI Vietnamese→English synonym mappings ──
  'học sâu': ['deep-learning', 'neural-network'],
  'học máy': ['machine-learning', 'ml'],
  'trí tuệ nhân tạo': ['artificial-intelligence', 'ai'],
  'mô hình ngôn ngữ': ['language-model', 'llm'],
  'xử lý ngôn ngữ tự nhiên': ['nlp', 'natural-language-processing'],
  'thị giác máy tính': ['computer-vision', 'cv'],
  'tạo sinh': ['generative-ai', 'generative'],
  'cloud': ['cloud', 'cloud-native'],
  'đám mây': ['cloud', 'cloud-native'],
  'vùng chứa': ['container', 'docker'],
  'cổng kết nối': ['gateway', 'api-gateway'],
  'lưu trữ': ['storage', 'persistence'],
  'phục hồi': ['recovery', 'restore', 'disaster-recovery'],
  'tạo khuôn mẫu': ['template', 'scaffolding', 'boilerplate'],
  'quy mô lớn': ['scalable', 'high-scale', 'distributed'],
  'thời gian thực': ['realtime', 'real-time'],
  'xử lý đồng thời': ['concurrency', 'async', 'parallel'],
  'đồng bộ dữ liệu': ['sync', 'data-sync', 'replication'],
  'mã xác thực': ['otp', '2fa', 'mfa', 'authentication'],
  'phát hiện xâm nhập': ['ids', 'intrusion-detection', 'security-scanner'],
  'điểm truy cập': ['endpoint', 'api'],
  'quản lý cấu hình': ['configuration', 'config-management', 'infrastructure-as-code'],
  'biến số môi trường': ['env', 'environment-variable', 'config'],
  'trích xuất dữ liệu': ['etl', 'data-pipeline', 'scraping'],
  'tái cấu trúc': ['refactoring', 'rewrite', 'migration'],
  'hiệu suất cao': ['high-performance', 'fast', 'optimized'],
  'phi tập trung': ['decentralized', 'p2p', 'distributed'],
  'nén dữ liệu': ['compression', 'archive'],
  'chạy ngầm': ['daemon', 'background', 'service'],

  // ── Additional synonym mappings for compound Vietnamese phrases ──
  'quản lý mã nguồn': ['version-control', 'git', 'scm'],
  'máy chủ chat': ['chat-server', 'messaging', 'irc'],
  'máy chủ email': ['mail-server', 'smtp', 'imap'],
  'đăng ký container': ['container-registry', 'docker-registry'],
  'quản lý container': ['container-orchestration', 'kubernetes'],
  'máy chủ dns': ['dns-server', 'dns'],
  'lưu trữ đối tượng': ['object-storage', 's3', 'minio'],
  'quản lý định danh': ['identity-management', 'idp', 'sso'],
  'đăng nhập một lần': ['sso', 'single-sign-on', 'oauth'],
  'phát hiện sự cố': ['incident-detection', 'alerting'],
  'quản lý sự cố': ['incident-management', 'sre'],
  // ── Additional high-ROI synonym compounds for Vietnamese developer queries ──
  'máy chủ web': ['web-server', 'http-server'],
  'trạm làm việc': ['workstation', 'desktop'],
  'bảng trạng thái': ['status-page', 'uptime-monitor'],
  'cổng api': ['api-gateway', 'rest-api'],
  'máy chủ proxy': ['proxy-server', 'reverse-proxy'],
  'kiểm soát truy cập': ['access-control', 'rbac'],
  'phiên bản hóa': ['versioning', 'git'],
  'mã nguồn đóng': ['proprietary', 'closed-source'],
  'tối ưu hóa': ['optimization', 'performance-tuning'],
  'quét bảo mật': ['security-scanning', 'vulnerability-scan'],
  'báo cáo lỗi': ['issue-tracker', 'bug-tracker'],
  'máy chủ tệp': ['file-server', 'nas'],
  'máy chủ in': ['print-server'],
  // ── Additional compound synonyms for Vietnamese developer queries ──
  'công cụ': ['tool', 'cli', 'utility'],
  'hàng đợi': ['queue', 'message-queue', 'job-queue'],
  'luồng': ['thread', 'stream', 'concurrency'],
  'sự kiện': ['event', 'event-driven'],
  'xác thực': ['authentication', 'auth', 'verification'],
  'môi trường': ['environment', 'env', 'deployment'],
  'phụ thuộc': ['dependency', 'package-manager'],
  'chạy thử': ['preview', 'sandbox', 'staging'],
  'điều hướng': ['routing', 'navigation', 'router'],
  'biểu diễn': ['rendering', 'render', 'visualization'],
  'trạng thái': ['state', 'state-management'],
  'chuyển đổi': ['converter', 'transformer', 'migration'],
  'tạo mã': ['code-generation', 'scaffolding'],
  'trích xuất': ['extraction', 'parser', 'scraper'],
  'hợp nhất': ['merge', 'integration', 'unification'],
  'loại bỏ': ['deduplication', 'cleanup', 'pruning'],
  'định tuyến': ['routing', 'router', 'gateway'],
  'phân phối': ['distribution', 'delivery', 'cdn'],
  'mở khóa': ['unlock', 'licensing', 'activation'],
  'khóa': ['lock', 'encryption', 'mutex'],
  'phím tắt': ['shortcut', 'hotkey', 'keybinding'],
  'giao thức': ['protocol', 'http', 'grpc'],
  'di chuyển': ['migration', 'transfer', 'port'],
  'thống nhất': ['standardization', 'linting', 'formatting'],
  'phân tán': ['distributed', 'decentralized', 'p2p'],
  'tập trung': ['centralized', 'monolithic'],
  'dự án': ['project', 'project-management'],
  'quản lý dự án': ['project-management', 'task-management', 'kanban'],
  'hệ thống nhắn tin': ['messaging-system', 'chat'],
  'trực quan hóa': ['visualization', 'charting', 'dashboard'],
};

/**
 * Given Vietnamese text and its local-translation output, return additional
 * GitHub-search-friendly expanded keywords derived from synonym expansion.
 * Pure function, no LLM call.
 *
 * For each Vietnamese phrase in the query that appears in VIETNAMESE_GITHUB_SYNONYMS,
 * we include the synonym entries as additional expanded keywords. This broadens
 * recall without extra GitHub API calls — the synonyms become expandedKeywords
 * in SearchCriteria, which `buildSearchParamsArray` deduplicates.
 */
export function expandGithubSynonyms(
  originalLower: string,
  translatedParts: string[],
): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();

  // Don't re-add terms already in the primary translation
  const translatedSet = new Set(translatedParts.map(p => p.toLowerCase()));

  for (const [viPhrase, synonyms] of Object.entries(VIETNAMESE_GITHUB_SYNONYMS)) {
    if (originalLower.includes(viPhrase)) {
      for (const syn of synonyms) {
        if (!seen.has(syn) && !translatedSet.has(syn)) {
          seen.add(syn);
          expanded.push(syn);
        }
      }
    }
  }

  return expanded.slice(0, 6); // cap at 6 to avoid query explosion
}

// ── Vietnamese intent classification ──

/**
 * Maps Vietnamese query patterns to search intent slugs. This is a
 * deterministic helper that identifies the user's intent from common
 * Vietnamese phrasing patterns WITHOUT requiring an LLM call.
 *
 * The identified intent feeds into SearchCriteria.intent, which powers
 * `INTENT_TOPIC_CLUSTERS` in the ranking engine. This means Vietnamese
 * queries get topic-cluster boosts even before the LLM returns.
 */
const VIETNAMESE_INTENT_PATTERNS: Array<{ pattern: RegExp; intent: string }> = [
  // DevOps / CI/CD
  { pattern: /ci[\s/\\-]?cd|tích hợp liên tục|triển khai liên tục|đường ống|ống dẫn|xây dựng/i, intent: 'devops-tool' },
  // Monitoring / observability
  { pattern: /giám sát|theo dõi|quan sát|nhật ký|chỉ số|cảnh báo/i, intent: 'monitoring' },
  // Password management — MUST come before security-tool since "quản lý mật khẩu" also contains "mật khẩu"
  { pattern: /quản lý mật khẩu|kho mật khẩu|mật khẩu/i, intent: 'password-manager' },
  // Security tools — "mật khẩu" is removed here since password-manager takes priority for that term;
  // "bảo mật" (security) still catches general security queries
  { pattern: /bảo mật|mã hóa|chứng thực|phân quyền|an toàn|quản lý bí mật|quét lỗ hổng/i, intent: 'security-tool' },
  // Self-hosted
  { pattern: /tự host|tự chạy|riêng tư|tại chỗ|on-?premise/i, intent: 'self-hosted' },
  // Backup/DR — must come before database so "sao lưu dự phòng" → self-hosted not database
  { pattern: /sao lưu dự phòng|disaster.recovery|backup.solution|phục hồi dữ liệu/i, intent: 'self-hosted' },
  // Data visualization — must come before database so "trực quan dữ liệu" → library not database
  { pattern: /trực quan dữ liệu|trực quan hóa|dashboard.*dữ liệu|chart|biểu đồ/i, intent: 'library' },
  // Database
  { pattern: /cơ sở dữ liệu|dữ liệu|kho dữ liệu|sql|truy vấn|sao lưu|phục hồi/i, intent: 'database' },
  // AI/ML
  { pattern: / trí tuệ nhân tạo|học máy|học sâu|mô hình ngôn ngữ|xử lý ngôn ngữ tự nhiên|thị giác máy tính|tạo sinh|huấn luyện|suy luận|ai\b|ml\b|llm\b/i, intent: 'ai-ml-tool' },
  // Networking — must come before web-app so "proxy" and "gateway" don't get mis-classified
  { pattern: /mạng|tường lửa|cân bằng tải|vpn|proxy|dns|điều hướng|reverse.proxy|api.gateway/i, intent: 'networking-tool' },
  // CLI tool
  { pattern: /giao diện dòng lệnh|cli|command.line|terminal|shell/i, intent: 'cli-tool' },
  // Mobile
  { pattern: /ứng dụng di động|mobile|ios|android|điện thoại/i, intent: 'mobile-app' },
  // API design — must come before web-app so "thiết kế api" → 'api' not 'web-app'
  { pattern: /thiết kế api|api.design|graphql|openapi|swagger|rest.api/i, intent: 'api' },
  // Web framework — "api" is intentionally broad but comes after api and networking
  { pattern: /trang web|ứng dụng web|frontend|backend|api|rest-api|giao diện lập trình/i, intent: 'web-app' },
  // Library
  { pattern: /thư viện|khung|package|module|gói/i, intent: 'library' },
  // ── Newly added intent patterns for broader Vietnamese query coverage ──
  // General backup/recovery
  { pattern: /sao lưu|khôi phục|backup|phục hồi dữ liệu/i, intent: 'database' },
  // Authentication — catches login/auth queries
  { pattern: /đăng nhập|xác thực người dùng|oauth|sso|single.sign.on/i, intent: 'authentication' },
  // Logging — catches observability queries focused on logs
  { pattern: /nhật ký hệ thống|log.analysis|phân tích log|xem log/i, intent: 'monitoring' },
  // Config management — catches infrastructure-as-code queries
  { pattern: /quản lý cấu hình|configuration.management|iác.quyền.tự.động|ansible|terraform/i, intent: 'devops-tool' },
  // Chat/messaging — catches communication tools
  { pattern: /trò chuyện|chat|messaging|nhắn tin|thông báo tức thời/i, intent: 'messaging' },
  // Editor/IDE — catches development tool queries
  { pattern: /trình soạn thảo|editor|ide|môi trường phát triển/i, intent: 'cli-tool' },
  // ── Additional high-ROI intent patterns ──
  // Data pipeline / ETL
  { pattern: /etl|đường ống dữ liệu|xử lý dữ liệu|khai thác dữ liệu|data.pipeline/i, intent: 'database' },
  // Vector database / embeddings (common in AI-adjacent queries)
  { pattern: /vector.database|nhúng|embedding|chỉ số vector|tìm kiếm ngữ nghĩa/i, intent: 'ai-ml-tool' },
  // CMS / content management
  { pattern: /quản lý nội dung|cms|nội dung web/i, intent: 'web-app' },
  // Search engine
  { pattern: /tìm kiếm toàn văn|search.engine|full.text.search|máy tìm kiếm/i, intent: 'library' },
  // Web server / proxy
  { pattern: /serve.*tĩnh|reverse.proxy|load.balancer|máy chủ ảo|proxy server/i, intent: 'networking-tool' },
  // Error tracking / observability (distinct from monitoring)
  { pattern: /theo dõi lỗi|error.tracking|sentry|theo dõi ngoại lệ/i, intent: 'monitoring' },
  // Automation / workflow
  { pattern: /tự động hóa quy trình|workflow.engine|no.code|codeless/i, intent: 'devops-tool' },
  // Machine learning ops (distinct from AI/ML tool — more infra-focused)
  { pattern: /ml.ops|mlops|quản lý mô hình|model.registry|serving mô hình/i, intent: 'devops-tool' },
  // ── Additional intent patterns for Vietnamese self-hosting community ──
  // Git / code hosting — very common in VN self-hosted queries
  { pattern: /quản lý mã nguồn|kho mã nguồn|git.server|gitea|forgejo|code.hosting/i, intent: 'devops-tool' },
  // Identity / SSO — keycloak, zitadel, authentik are popular in VN
  { pattern: /quản lý định danh|đăng nhập một lần|identity.management|idp|single.sign/i, intent: 'authentication' },
  // Wiki / knowledge base — outline, bookstack
  { pattern: /wiki|kiến thức|tài liệu chung|hợp tác tài liệu/i, intent: 'web-app' },
  // Notification / push — gotify, ntfy
  { pattern: /thông báo đẩy|push.notification|nhắc nhở tự động|gotify|ntfy/i, intent: 'messaging' },
  // File sharing / sync — nextcloud, seafile
  { pattern: /chia sẻ tệp|đồng bộ tệp|file.sharing|cloud.storage|nextcloud/i, intent: 'self-hosted' },
  // Project management
  { pattern: /quản lý dự án|project.management|kanban|bảng công việc/i, intent: 'web-app' },
  // ── Additional high-ROI intent patterns for common Vietnamese queries ──
  // Performance / profiling — "tối ưu" (optimize) queries are very common
  { pattern: /tối ưu|hiệu suất|nhanh nhất|tối ưu hóa|benchmark|xuất sắc/i, intent: 'devops-tool' },
  // Lightweight / minimal — common modifier in VN queries ("thư viện nhẹ")
  { pattern: /nhẹ|nhẹ lòng|tối thiểu|minimalist|ít phụ thuộc|zero.dependency/i, intent: 'library' },
  // Desktop app — "ứng dụng máy tính" currently has no match
  { pattern: /ứng dụng máy tính|ứng dụng desktop|desktop.app|electron|tauri/i, intent: 'desktop-app' },
  // Scaling / distributed — common in VN queries about enterprise needs
  { pattern: /mở rộng|quy mô lớn|phân tán|cluster|scaling|high.availability/i, intent: 'devops-tool' },
  // Container runtime — catches "chạy container", "container runtime" queries
  { pattern: /chạy container|container.runtime|podman|containerd|crun/i, intent: 'containerization' },
  // Version control — "quản lý phiên bản" alone (not just compound "quản lý mã nguồn")
  { pattern: /quản lý phiên bản|phiên bản hóa|version.control|git.hook/i, intent: 'devops-tool' },
  // Data pipeline / ETL — broader patterns for data engineering queries
  { pattern: /xử lý dữ liệu lớn|big.data|data.lake|data.warehouse|etl.pipeline|airflow/i, intent: 'database' },
  // Knowledge / wiki — common in VN self-hosting community queries
  { pattern: /hệ thống tri thức|knowledge.base|outline|bookstack|notion/i, intent: 'web-app' },
  // ── Additional high-ROI Vietnamese intent patterns (common developer queries) ──
  // Project management — "quản lý dự án" is extremely common
  { pattern: /quản lý dự án|project.management|kanban|bảng công việc|bảng kanban/i, intent: 'web-app' },
  // Email server — common self-hosting query
  { pattern: /máy chủ email|email.server|mail.server|smtp|imap|thư điện tử/i, intent: 'self-hosted' },
  // Documentation/generator — "tài liệu", "trình tạo" queries
  { pattern: /trình tạo tài liệu|doc.generator|static.site|tạo trang|tạo tài liệu/i, intent: 'library' },
  // State management — common frontend query
  { pattern: /quản lý trạng thái|state.management|quản lý state/i, intent: 'library' },
  // Testing tool — "công cụ kiểm thử" distinct from "kiểm thử" alone
  { pattern: /công cụ kiểm thử|kiểm thử tự động|e2e.*test|unit.test|testing.framework/i, intent: 'testing' },
  // Event/streaming — "xử lý sự kiện" data pipeline queries
  { pattern: /xử lý sự kiện|event.driven|stream.processing|message.queue|hàng đợi tin nhắn/i, intent: 'library' },
  // PDF/document processing — common utility query
  { pattern: /xử lý pdf|pdf.*tool|chuyển đổi pdf|doc.*processing|trích xuất văn bản/i, intent: 'library' },
  // DNS/network resolution — distinct from general networking queries
  { pattern: /phân giải dns|dns.*resolver|máy chủ dns|dns.server/i, intent: 'networking-tool' },
];

/**
 * Classify the search intent of a Vietnamese query using pattern matching.
 * Returns an intent slug string (matching the values in INTENT_ANGLES / INTENT_TOPIC_CLUSTERS),
 * or null if no pattern matches (caller should fall back to LLM intent classification).
 *
 * Pure function, no LLM call.
 */
export function classifyVietnameseIntent(text: string): string | null {
  // Also check the English translation parts for tech terms that imply intent
  for (const { pattern, intent } of VIETNAMESE_INTENT_PATTERNS) {
    if (pattern.test(text)) {
      return intent;
    }
  }
  return null;
}

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