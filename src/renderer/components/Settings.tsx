import React, { useState, useEffect } from 'react';
import type { AppSettings, OllamaModel } from '../../shared/types';

interface Props {
  settings: AppSettings;
  ollamaModels: OllamaModel[];
  ollamaConnected: boolean;
  githubUser: string | null;
  githubValid: boolean | null;
  onSave: (s: Partial<AppSettings>) => Promise<boolean>;
  onCheckOllama: (url?: string) => void;
  onCheckGitHub: (token?: string) => void;
  onClose: () => void;
}

export default function Settings({
  settings, ollamaModels, ollamaConnected, githubUser, githubValid,
  onSave, onCheckOllama, onCheckGitHub, onClose,
}: Props) {
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaBaseUrl);
  const [ollamaModel, setOllamaModel] = useState(settings.ollamaModel);
  const [githubToken, setGithubToken] = useState(settings.githubToken);
  const [theme, setTheme] = useState<AppSettings['theme']>(settings.theme);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOllamaUrl(settings.ollamaBaseUrl);
    setGithubToken(settings.githubToken);
    setTheme(settings.theme);
  }, [settings]);

  // Sync model selection when models load: if current model isn't in the list, pick the first one
  useEffect(() => {
    if (ollamaModels.length > 0) {
      const isValid = ollamaModels.some((m) => m.name === ollamaModel);
      if (!isValid) {
        setOllamaModel(ollamaModels[0].name);
      }
    }
  }, [ollamaModels]);

  const handleSave = async () => {
    setSaving(true);
    const ok = await onSave({ ollamaBaseUrl: ollamaUrl, ollamaModel, githubToken, theme });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        {/* Theme */}
        <section className="settings-section">
          <h3>Appearance</h3>
          <label className="settings-field">
            Theme
            <div className="theme-toggle">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  className={`theme-option ${theme === t ? 'theme-option-active' : ''}`}
                  onClick={() => setTheme(t)}
                  type="button"
                >
                  {t === 'light' && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" />
                      <line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                  )}
                  {t === 'dark' && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                  {t === 'system' && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  )}
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </label>
        </section>

        {/* Ollama */}
        <section className="settings-section">
          <h3>Ollama Connection</h3>
          <label className="settings-field">
            Base URL
            <div className="field-row">
              <input
                type="text"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
              <button className="btn-secondary" onClick={() => onCheckOllama(ollamaUrl)}>
                Test
              </button>
            </div>
          </label>
          {ollamaConnected && (
            <div className="settings-success">Connected — {ollamaModels.length} model(s) available</div>
          )}
          <label className="settings-field">
            Model
            <div className="field-row">
              <select value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}>
                {ollamaModels.length === 0 && <option value={ollamaModel}>{ollamaModel}</option>}
                {ollamaModels.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
          </label>
        </section>

        {/* GitHub */}
        <section className="settings-section">
          <h3>GitHub Authentication</h3>
          <label className="settings-field">
            Personal Access Token
            <div className="field-row">
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="ghp_..."
              />
              <button className="btn-secondary" onClick={() => onCheckGitHub(githubToken)}>
                Verify
              </button>
            </div>
          </label>
          {githubValid && githubUser && (
            <div className="settings-success">Authenticated as {githubUser}</div>
          )}
          {githubValid === false && (
            <div className="settings-error">Token invalid or expired</div>
          )}
        </section>

        <div className="settings-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}