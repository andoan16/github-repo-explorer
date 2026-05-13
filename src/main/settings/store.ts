import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types';

export class SettingsStore {
  private filePath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = join(userDataPath, 'settings.json');
  }

  load(): AppSettings {
    try {
      if (!existsSync(this.filePath)) {
        this.save(DEFAULT_SETTINGS);
        return { ...DEFAULT_SETTINGS };
      }
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  save(settings: AppSettings): void {
    try {
      const dir = join(this.filePath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }
}
