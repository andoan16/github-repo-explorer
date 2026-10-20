import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import { SettingsStore } from '../../src/main/settings/store';
import { safeStorage } from 'electron';

import { resolve } from 'path';

const mockUserData = resolve(process.cwd(), '.test-settings');
const settingsFile = join(mockUserData, 'settings.json');
const tokenFile = join(mockUserData, 'github-token.enc');
const ollamaKeyFile = join(mockUserData, 'ollama-api-key.enc');

// Mock electron
vi.mock('electron', () => {
  return {
    app: {
      getPath: (name: string) => {
        if (name === 'userData') {
          return require('path').resolve(process.cwd(), '.test-settings');
        }
        return '/mock/path';
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (str: string) => Buffer.from(`encrypted_${str}`),
      decryptString: (buf: Buffer) => buf.toString('utf-8').replace('encrypted_', ''),
    },
  };
});

describe('SettingsStore', () => {
  let store: SettingsStore;
  let isEncryptionAvailableOriginal: boolean = true;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(mockUserData)) {
      rmSync(mockUserData, { recursive: true, force: true });
    }
    mkdirSync(mockUserData, { recursive: true });

    // Reset mocks
    vi.clearAllMocks();
    isEncryptionAvailableOriginal = true;
    safeStorage.isEncryptionAvailable = vi.fn(() => isEncryptionAvailableOriginal);

    // Suppress console error/warn during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    store = new SettingsStore();
  });

  afterEach(() => {
    if (existsSync(mockUserData)) {
      rmSync(mockUserData, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('starts with default settings when no files exist', () => {
    const settings = store.load();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('loads non-secret settings and ignores secrets in settings.json', () => {
    const data = {
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      githubToken: 'should-be-ignored',
      ollamaApiKey: 'should-be-ignored-too',
    };
    writeFileSync(settingsFile, JSON.stringify(data));

    const settings = store.load();
    expect(settings.theme).toBe('dark');
    expect(settings.githubToken).toBe('');
    expect(settings.ollamaApiKey).toBe('');
  });

  it('loads encrypted tokens and keys when encryption is available', () => {
    writeFileSync(tokenFile, Buffer.from('encrypted_test-token'));
    writeFileSync(ollamaKeyFile, Buffer.from('encrypted_test-key'));

    const settings = store.load();
    expect(settings.githubToken).toBe('test-token');
    expect(settings.ollamaApiKey).toBe('test-key');
  });

  it('loads plaintext tokens and keys when encryption is unavailable', () => {
    isEncryptionAvailableOriginal = false;
    writeFileSync(tokenFile, 'plaintext-token');
    writeFileSync(ollamaKeyFile, 'plaintext-key');

    const settings = store.load();
    expect(settings.githubToken).toBe('plaintext-token');
    expect(settings.ollamaApiKey).toBe('plaintext-key');
  });

  it('saves non-secret settings without secrets in settings.json', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      theme: 'dark' as const,
      githubToken: 'test-token',
      ollamaApiKey: 'test-key',
    };

    store.save(settings);

    const raw = readFileSync(settingsFile, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.theme).toBe('dark');
    expect(parsed.githubToken).toBeUndefined();
    expect(parsed.ollamaApiKey).toBeUndefined();
  });

  it('saves encrypted tokens and keys when encryption is available', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      githubToken: 'test-token',
      ollamaApiKey: 'test-key',
    };

    store.save(settings);

    expect(readFileSync(tokenFile).toString()).toBe('encrypted_test-token');
    expect(readFileSync(ollamaKeyFile).toString()).toBe('encrypted_test-key');
  });

  it('saves plaintext tokens and keys when encryption is unavailable', () => {
    isEncryptionAvailableOriginal = false;
    const settings = {
      ...DEFAULT_SETTINGS,
      githubToken: 'test-token',
      ollamaApiKey: 'test-key',
    };

    store.save(settings);

    expect(readFileSync(tokenFile, 'utf-8')).toBe('test-token');
    expect(readFileSync(ollamaKeyFile, 'utf-8')).toBe('test-key');
  });

  it('writes empty buffer for empty tokens and keys', () => {
    // First save something
    const settingsWithTokens = {
      ...DEFAULT_SETTINGS,
      githubToken: 'test-token',
      ollamaApiKey: 'test-key',
    };
    store.save(settingsWithTokens);

    expect(existsSync(tokenFile)).toBe(true);
    expect(existsSync(ollamaKeyFile)).toBe(true);

    // Now save empty
    const settingsEmpty = {
      ...DEFAULT_SETTINGS,
      githubToken: '',
      ollamaApiKey: '',
    };
    store.save(settingsEmpty);

    expect(readFileSync(tokenFile).length).toBe(0);
    expect(readFileSync(ollamaKeyFile).length).toBe(0);
  });
});
