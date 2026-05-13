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
  const [maxResults, setMaxResults] = useState(settings.maxResults);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOllamaUrl(settings.ollamaBaseUrl);
    setOllamaModel(settings.ollamaModel);
    setGithubToken(settings.githubToken);
    setMaxResults(settings.maxResults);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    const ok = await onSave({ ollamaBaseUrl: ollamaUrl, ollamaModel, githubToken, maxResults });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

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
              <input
                type="text"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                placeholder="Custom model name"
                className="model-input"
              />
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

        {/* Display */}
        <section className="settings-section">
          <h3>Display</h3>
          <label className="settings-field">
            Max results
            <input
              type="number"
              min={5}
              max={50}
              value={maxResults}
              onChange={(e) => setMaxResults(parseInt(e.target.value, 10) || 20)}
            />
          </label>
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
