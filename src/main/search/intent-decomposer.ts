export interface AlternativeDetectionResult {
  isAlternative: boolean;
  benchmark?: string;
  cleanCoreDomain?: string;
  suggestedFeatures?: string[];
  suggestedTopics?: string[];
  suggestedQueries?: string[];
}

/** Known commercial software benchmarks and their core open-source domain/features */
const KNOWN_BENCHMARKS: Record<
  string,
  {
    canonical: string;
    regex: RegExp;
    coreDomain: string;
    features: string[];
    topics: string[];
    queries: string[];
  }
> = {
  adobe_pdf: {
    canonical: 'Adobe Acrobat',
    regex: /\badobe\s+(?:acrobat|pdf\s*editor|reader|pdf)\b|\bacrobat\b|\bpdf\s*editor\s+(?:của|of)\s+adobe\b/i,
    coreDomain: 'pdf editor',
    features: ['edit', 'annotate', 'sign', 'merge', 'split', 'compress', 'convert', 'secure', 'ocr', 'form'],
    topics: ['pdf-editor', 'pdf-tools', 'pdf', 'pdf-manipulation', 'pdf-toolkit'],
    queries: ['pdf toolkit', 'pdf editor', 'pdf tools', 'open source pdf'],
  },
  adobe_photoshop: {
    canonical: 'Adobe Photoshop',
    regex: /\badobe\s+photoshop\b|\bphotoshop\b/i,
    coreDomain: 'photo editor image manipulation',
    features: ['image-editor', 'layer', 'drawing', 'canvas', 'raster'],
    topics: ['image-editor', 'photo-editor', 'graphics'],
    queries: ['photo editor', 'image editor', 'image manipulation'],
  },
  notion: {
    canonical: 'Notion',
    regex: /\bnotion\b/i,
    coreDomain: 'knowledge base notes wiki',
    features: ['markdown', 'notes', 'wiki', 'kanban', 'blocks'],
    topics: ['knowledge-base', 'notes', 'wiki', 'pkm'],
    queries: ['knowledge base', 'notes wiki', 'pkm markdown'],
  },
  jira: {
    canonical: 'Jira',
    regex: /\bjira\b/i,
    coreDomain: 'issue tracker project management',
    features: ['kanban', 'agile', 'sprint', 'tickets', 'backlog'],
    topics: ['issue-tracker', 'project-management', 'agile'],
    queries: ['issue tracker', 'project management', 'agile kanban'],
  },
  slack: {
    canonical: 'Slack',
    regex: /\bslack\b/i,
    coreDomain: 'team chat messaging',
    features: ['chat', 'channels', 'realtime', 'notifications', 'matrix'],
    topics: ['chat', 'messaging', 'team-communication'],
    queries: ['team chat', 'messaging channels', 'realtime chat'],
  },
  postman: {
    canonical: 'Postman',
    regex: /\bpostman\b/i,
    coreDomain: 'api client testing',
    features: ['rest-client', 'graphql', 'grpc', 'http-client', 'collections'],
    topics: ['api-client', 'rest-client', 'http-client'],
    queries: ['api client', 'rest client', 'http client'],
  },
  trello: {
    canonical: 'Trello',
    regex: /\btrello\b/i,
    coreDomain: 'kanban board task management',
    features: ['kanban', 'boards', 'tasks', 'todo'],
    topics: ['kanban', 'task-management', 'todo'],
    queries: ['kanban board', 'task management', 'kanban todo'],
  },
  figma: {
    canonical: 'Figma',
    regex: /\bfigma\b/i,
    coreDomain: 'ui design vector graphics',
    features: ['vector', 'prototyping', 'canvas', 'design-tool'],
    topics: ['design-tool', 'ui-design', 'vector-graphics'],
    queries: ['vector graphics editor', 'ui design tool', 'vector canvas'],
  },
};

const ALTERNATIVE_PATTERNS = [
  // Vietnamese patterns
  /(?:phần\s+mềm\s+|công\s+cụ\s+|ứng\s+dụng\s+)?(?:thay\s+thế|thay\s+cho|thay\s+thế\s+cho)\s+(.+)/i,
  /(?:tương\s+tự|tương\s+đương|giống)\s+(?:như\s+)?(.+)/i,
  // English patterns
  /(?:open\s*source\s+)?alternative\s+(?:to|for)\s+(.+)/i,
  /replacement\s+for\s+(.+)/i,
  /like\s+(.+?)\s+but\s+open\s*source/i,
  /open\s*source\s+(?:version\s+of\s+)?(.+)/i,
];

export function detectAlternativeRequest(text: string): AlternativeDetectionResult {
  const lower = text.toLowerCase().trim();

  // 1. Check known commercial benchmarks first
  for (const b of Object.values(KNOWN_BENCHMARKS)) {
    if (b.regex.test(lower)) {
      // Check if it's an alternative request or contains replacement keywords
      const isAlt =
        ALTERNATIVE_PATTERNS.some((p) => p.test(lower)) ||
        lower.includes('thay thế') ||
        lower.includes('alternative') ||
        lower.includes('replace') ||
        lower.includes('open source');

      if (isAlt) {
        return {
          isAlternative: true,
          benchmark: b.canonical,
          cleanCoreDomain: b.coreDomain,
          suggestedFeatures: b.features,
          suggestedTopics: b.topics,
          suggestedQueries: b.queries,
        };
      }
    }
  }

  // 2. Generic pattern match
  for (const pattern of ALTERNATIVE_PATTERNS) {
    const match = lower.match(pattern);
    if (match && match[1]) {
      const benchmarkRaw = match[1].trim();
      // Clean noise words
      const cleanBenchmark = benchmarkRaw
        .replace(/^(của|of|cho|for)\s+/i, '')
        .trim();

      return {
        isAlternative: true,
        benchmark: cleanBenchmark,
        suggestedFeatures: ['open-source', 'self-hosted', 'free'],
      };
    }
  }

  return { isAlternative: false };
}
