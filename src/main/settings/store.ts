import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types';

/**
 * SettingsStore persists app settings to disk.
 *
 * Security: the GitHub token is encrypted at rest using Electron's safeStorage
 * API (Keychain on macOS, DPAPI on Windows, libsecret on Linux) and stored in a
 * separate file from the rest of the settings. The plaintext token never touches
 * disk. If safeStorage is not available (e.g. Linux without libsecret), we fall
 * back to storing the token in plaintext with a warning, but only if non-empty.
 */
export class SettingsStore {
  private filePath: string;
  private tokenFilePath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = join(userDataPath, 'settings.json');
    this.tokenFilePath = join(userDataPath, 'github-token.enc');
  }

  load(): AppSettings {
    try {
      let settings: AppSettings = { ...DEFAULT_SETTINGS };

      // Load non-secret settings from settings.json
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        // Never trust the githubToken field from settings.json — it's stored
        // encrypted in a separate file. Strip it if present (legacy migration).
        const { githubToken: _ignored, ...rest } = parsed;
        settings = { ...DEFAULT_SETTINGS, ...rest };
      }

      // Load encrypted GitHub token from separate file
      settings.githubToken = this.loadToken();

      return settings;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  save(settings: AppSettings): void {
    try {
      const dir = join(this.filePath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      // Save non-secret settings to settings.json (without the token)
      const { githubToken: _token, ...rest } = settings;
      writeFileSync(this.filePath, JSON.stringify(rest, null, 2), 'utf-8');

      // Save encrypted GitHub token to separate file
      this.saveToken(settings.githubToken);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  private loadToken(): string {
    try {
      if (!existsSync(this.tokenFilePath)) return '';
      const encrypted = readFileSync(this.tokenFilePath);

      if (encrypted.length === 0) return '';

      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(encrypted);
      }

      // Fallback: plaintext (legacy or Linux without libsecret)
      // Only used when safeStorage is unavailable. Warn once.
      console.warn('[settings] safeStorage encryption unavailable — token stored in plaintext');
      return encrypted.toString('utf-8');
    } catch (err) {
      console.error('Failed to load GitHub token:', err);
      return '';
    }
  }

  private saveToken(token: string): void {
    try {
      if (!token) {
        // If token is empty, remove the file if it exists
        if (existsSync(this.tokenFilePath)) {
          writeFileSync(this.tokenFilePath, Buffer.alloc(0));
        }
        return;
      }

      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(token);
        writeFileSync(this.tokenFilePath, encrypted);
      } else {
        // Fallback: plaintext (legacy or Linux without libsecret)
        console.warn('[settings] safeStorage encryption unavailable — token stored in plaintext');
        writeFileSync(this.tokenFilePath, token, 'utf-8');
      }
    } catch (err) {
      console.error('Failed to save GitHub token:', err);
    }
  }
}