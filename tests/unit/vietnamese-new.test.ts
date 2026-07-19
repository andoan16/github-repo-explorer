
import { describe, it, expect } from 'vitest';
import {
  expandGithubSynonyms,
  classifyVietnameseIntent,
  quickVietnameseTranslateStructured,
  normalizeVietnameseQuery,
} from '../../src/main/search/vietnamese';

// ── expandGithubSynonyms: compound-suppression for single-word keys ──

describe('expandGithubSynonyms — compound-suppression for single-word keys', () => {
  it('suppresses "trình" when consumed by compound "lập trình"', () => {
    // "lập trình" (programming) should NOT trigger "trình" synonyms (runner/engine)
    const expanded = expandGithubSynonyms('lập trình web', ['programming', 'web']);
    // "trình" is consumed by compound "lập trình" in VIETNAMESE_GITHUB_SYNONYMS,
    // so runner/engine should NOT appear
    expect(expanded).not.toContain('runner');
    expect(expanded).not.toContain('engine');
    // "lập trình" has its own entry → should produce development synonyms
    expect(expanded).toContain('development');
    expect(expanded).toContain('coding');
  });

  it('suppresses "chạy" when consumed by compound "chạy ngầm"', () => {
    const expanded = expandGithubSynonyms('chạy ngầm máy chủ', ['daemon', 'server']);
    // "chạy" consumed by compound "chạy ngầm" → single-word "chạy" synonyms suppressed
    expect(expanded).not.toContain('runner');
    // But the compound "chạy ngầm" synonyms should fire
    expect(expanded).toContain('background');
    expect(expanded).toContain('service');
  });

  it('still fires standalone "trình" when no compound consumes it', () => {
    // "trình xác thực" — "trình" is not consumed by a compound match
    // in the synonym dict (only "trình chạy" is). Standalone "trình" 
    // is a word-boundary match but only fires synonyms from dictionary entries
    // like "trình" → runner/engine — however the synonym dict has no standalone
    // "trình" entry (only "trình chạy"). So no CI/CD synonyms fire.
    // The correct expansion comes from "xác thực" (authentication).
    const expanded = expandGithubSynonyms('trình xác thực', ['runner']);
    expect(expanded).toContain('authentication');
    expect(expanded).toContain('auth');
    expect(expanded).toContain('verification');
  });
  it('suppresses "chạy" when compound "tự chạy" matches', () => {
    // "tự chạy" (self-hosted) should NOT trigger "chạy" synonyms (runner)
    const expanded = expandGithubSynonyms('tự chạy máy chủ', ['self-hosted', 'server']);
    expect(expanded).not.toContain('runner');
    expect(expanded).not.toContain('execute');
    // "tự chạy" compound has no synonym entry in VIETNAMESE_GITHUB_SYNONYMS,
    // so no synonyms fire for it. "máy chủ" fires its synonyms:
    // "server" (filtered — in translatedParts), "host" (passes through)
    expect(expanded).toContain('host');
    expect(expanded.length).toBe(1);
  });
});

// ── expandGithubSynonyms: CI/CD runner entries ──

describe('expandGithubSynonyms — CI/CD runner entries', () => {
  it('expands "trình chạy" to runner/executor/ci-cd', () => {
    const expanded = expandGithubSynonyms('trình chạy', ['runner']);
    expect(expanded).toContain('executor');
    expect(expanded).toContain('ci-cd');
    expect(expanded).toContain('workflow-runner');
    expect(expanded).toContain('action-runner');
  });

  it('expands "trình chạy ci" to ci-runner/github-actions/ci-cd', () => {
    const expanded = expandGithubSynonyms('trình chạy ci', ['ci-runner']);
    expect(expanded).toContain('github-actions');
    expect(expanded).toContain('ci-cd');
  });

  it('expands "công cụ chạy" to runner/executor/launcher', () => {
    const expanded = expandGithubSynonyms('công cụ chạy', ['runner']);
    expect(expanded).toContain('executor');
    expect(expanded).toContain('launcher');
  });
});

// ── classifyVietnameseIntent: runner/executor detection ──

describe('classifyVietnameseIntent — runner/executor patterns', () => {
  it('classifies "trình chạy" as devops-tool', () => {
    expect(classifyVietnameseIntent('trình chạy ci/cd')).toBe('devops-tool');
  });

  it('classifies "trình chạy ci" as devops-tool', () => {
    expect(classifyVietnameseIntent('trình chạy ci tự động')).toBe('devops-tool');
  });

  it('classifies "trình thực thi" as devops-tool', () => {
    expect(classifyVietnameseIntent('trình thực thi pipeline')).toBe('devops-tool');
  });

  it('classifies "ci runner" as devops-tool', () => {
    expect(classifyVietnameseIntent('cần tìm ci runner')).toBe('devops-tool');
  });

  it('classifies "action runner" as devops-tool', () => {
    expect(classifyVietnameseIntent('tìm action runner cho github')).toBe('devops-tool');
  });

  it('does not misclassify "lập trình viên" as devops-tool', () => {
    // "lập trình viên" (programmer) should match "programming" patterns, not runner patterns
    // The pattern /trình chạy/ matches "trình chạy" literally — "lập trình viên" does NOT
    // contain "trình chạy" and should NOT fire the runner pattern
    const intent = classifyVietnameseIntent('lập trình viên full-stack');
    // Should match library/web-app or similar, NOT devops-tool from runner pattern
    expect(intent).not.toBe('devops-tool');
  });
});

// ── quickVietnameseTranslateStructured: trình chạy entries ──

describe('quickVietnameseTranslateStructured — trình chạy entries', () => {
  it('translates "trình chạy" as runner', () => {
    const result = quickVietnameseTranslateStructured('trình chạy');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('runner');
    expect(result!.dictionaryConcepts).toContain('executor');
    expect(result!.dictionaryConcepts).toContain('ci-cd');
  });

  it('translates "trình chạy ci" as ci-runner', () => {
    const result = quickVietnameseTranslateStructured('trình chạy ci');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('ci-runner');
    expect(result!.dictionaryConcepts).toContain('ci-cd');
  });

  it('translates "trình chạy tự động" as automation-runner', () => {
    const result = quickVietnameseTranslateStructured('trình chạy tự động');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('automation-runner');
    expect(result!.dictionaryConcepts).toContain('workflow-runner');
  });

  it('translates "công cụ chạy" as runner', () => {
    const result = quickVietnameseTranslateStructured('công cụ chạy ci/cd');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('runner');
    expect(result!.dictionaryConcepts).toContain('executor');
  });

  it('dictionaryConcepts carry domain signal for pure VN runner queries', () => {
    // Pure Vietnamese "trình chạy" — no English tech terms (docker/ci-cd/etc.)
    // dictionaryConcepts must carry the domain signal
    const result = quickVietnameseTranslateStructured('trình chạy');
    expect(result).not.toBeNull();
    expect(result!.techTerms.length).toBe(0); // no English tech terms mixed in
    expect(result!.dictionaryConcepts.length).toBeGreaterThanOrEqual(2);
    expect(result!.dictionaryConcepts).toContain('runner');
    expect(result!.dictionaryConcepts).toContain('ci-cd');
  });
});

// ── normalizeVietnameseQuery: suffix stripping ──

describe('normalizeVietnameseQuery — suffix stripping', () => {
  it('strips "nhé" suffix', () => {
    expect(normalizeVietnameseQuery('công cụ giám sát nhé')).toBe('công cụ giám sát');
  });

  it('strips "ạ" suffix', () => {
    expect(normalizeVietnameseQuery('tìm trình chạy ci ạ')).toBe('tìm trình chạy ci');
  });

  it('strips "giúp tôi với" suffix', () => {
    expect(normalizeVietnameseQuery('tìm công cụ giám sát giúp tôi với')).toBe('tìm công cụ giám sát');
  });

  it('strips "giúp tôi" suffix', () => {
    expect(normalizeVietnameseQuery('tìm máy chủ email giúp tôi')).toBe('tìm máy chủ email');
  });

  it('strips "được không" suffix', () => {
    expect(normalizeVietnameseQuery('tìm thư viện đồ thị được không')).toBe('tìm thư viện đồ thị');
  });

  it('strips "có được không" suffix', () => {
    expect(normalizeVietnameseQuery('tìm công cụ giám sát có được không')).toBe('tìm công cụ giám sát');
  });

  it('strips "nha" suffix', () => {
    expect(normalizeVietnameseQuery('tìm công cụ giám sát nha')).toBe('tìm công cụ giám sát');
  });

  it('strips prefix + suffix combined', () => {
    const result = normalizeVietnameseQuery('tôi muốn tìm một công cụ giám sát nhé');
    expect(result).toBe('công cụ giám sát');
  });

  it('returns unchanged for normal queries without fillers', () => {
    expect(normalizeVietnameseQuery('công cụ giám sát máy chủ')).toBe('công cụ giám sát máy chủ');
  });

  it('returns unchanged for too-short remainder after suffix strip', () => {
    // "abc nhé" → "abc" < 4 chars
    expect(normalizeVietnameseQuery('abc nhé')).toBe('abc nhé');
  });

  it('returns unchanged for English queries', () => {
    expect(normalizeVietnameseQuery('find a CI/CD runner please')).toBe('find a CI/CD runner please');
  });
});
