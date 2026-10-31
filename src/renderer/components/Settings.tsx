import React, { useState, useEffect } from 'react';
import {
  EMBEDDED_MODELS,
  type AppSettings,
  type OllamaModel,
  type OllamaMode,
  type LlmProvider,
  type EmbeddedModelId,
  type EmbeddedModelStatus,
} from '../../shared/types';

/** Default base URL for Ollama Cloud (without /api — the client appends /api/...). */
const CLOUD_BASE_URL = 'https://ollama.com';

interface Props {
  settings: AppSettings;
  llmProvider: LlmProvider;
  embeddedStatus: EmbeddedModelStatus;
  onDownloadEmbeddedModel: (modelId?: string) => void;
  ollamaModels: OllamaModel[];
  ollamaConnected: boolean;
  ollamaError?: string;
  ollamaChecking: boolean;
  githubUser: string | null;
  githubValid: boolean | null;
  onSave: (s: Partial<AppSettings>) => Promise<boolean>;
  onCheckOllama: (url?: string, apiKey?: string) => void;
  onCheckGitHub: (token?: string) => void;
  onClose: () => void;
}

export default function Settings({
  settings,
  llmProvider: currentLlmProvider,
  embeddedStatus,
  onDownloadEmbeddedModel,
  ollamaModels,
  ollamaConnected,
  ollamaError,
  ollamaChecking,
  githubUser,
  githubValid,
  onSave,
  onCheckOllama,
  onCheckGitHub,
  onClose,
}: Props) {
  const [llmProvider, setLlmProvider] = useState<LlmProvider>(settings.llmProvider ?? currentLlmProvider ?? 'embedded');
  const [embeddedModel, setEmbeddedModel] = useState<EmbeddedModelId>(
    settings.embeddedModel || embeddedStatus.systemSpecs?.suggestedModelId || 'qwen2.5-0.5b',
  );
  const [ollamaMode, setOllamaMode] = useState<OllamaMode>(settings.ollamaMode);
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaBaseUrl);
  const [ollamaApiKey, setOllamaApiKey] = useState(settings.ollamaApiKey);
  const [ollamaModel, setOllamaModel] = useState(settings.ollamaModel);
  const [githubToken, setGithubToken] = useState(settings.githubToken);
  const [theme, setTheme] = useState<AppSettings['theme']>(settings.theme);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLlmProvider(settings.llmProvider ?? 'embedded');
    if (settings.embeddedModel) {
      setEmbeddedModel(settings.embeddedModel);
    } else if (embeddedStatus.systemSpecs?.suggestedModelId) {
      setEmbeddedModel(embeddedStatus.systemSpecs.suggestedModelId);
    }
    setOllamaMode(settings.ollamaMode);
    setOllamaUrl(settings.ollamaBaseUrl);
    setOllamaApiKey(settings.ollamaApiKey);
    setGithubToken(settings.githubToken);
    setTheme(settings.theme);
  }, [settings, embeddedStatus.systemSpecs?.suggestedModelId]);

  // Sync model selection when models load: if current model isn't in the list, pick the first one
  useEffect(() => {
    if (ollamaModels.length > 0) {
      const isValid = ollamaModels.some((m) => m.name === ollamaModel);
      if (!isValid) {
        setOllamaModel(ollamaModels[0].name);
      }
    }
  }, [ollamaModels, ollamaModel]);

  const handleModeSwitch = (mode: OllamaMode) => {
    setOllamaMode(mode);
    if (mode === 'cloud' && ollamaUrl === 'http://localhost:11434') {
      setOllamaUrl(CLOUD_BASE_URL);
    } else if (mode === 'local' && ollamaUrl === CLOUD_BASE_URL) {
      setOllamaUrl('http://localhost:11434');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const effectiveApiKey = ollamaMode === 'cloud'
      ? (ollamaApiKey || settings.ollamaApiKey)
      : '';
    const effectiveGithubToken = githubToken || settings.githubToken;
    const ok = await onSave({
      llmProvider,
      embeddedModel,
      ollamaBaseUrl: ollamaUrl,
      ollamaApiKey: effectiveApiKey,
      ollamaMode,
      ollamaModel,
      githubToken: effectiveGithubToken,
      theme,
    });
    setSaving(false);
    if (ok) onClose();
  };

  const handleTest = () => {
    onCheckOllama(ollamaUrl, ollamaMode === 'cloud' ? ollamaApiKey : undefined);
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
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

        {/* AI Engine */}
        <section className="settings-section">
          <h3>AI Engine</h3>
          <label className="settings-field">
            <span>Nguồn mô hình</span>
            <div className="theme-toggle">
              <button
                type="button"
                className={`theme-option ${llmProvider === 'embedded' ? 'theme-option-active' : ''}`}
                onClick={() => setLlmProvider('embedded')}
              >
                Embedded (Local)
              </button>
              <button
                type="button"
                className={`theme-option ${llmProvider === 'ollama' ? 'theme-option-active' : ''}`}
                onClick={() => setLlmProvider('ollama')}
              >
                Ollama
              </button>
            </div>
          </label>

          {llmProvider === 'embedded' && (
            <div className="embedded-model-info" style={{ marginTop: '10px' }}>
              {/* System Specs Banner */}
              {embeddedStatus.systemSpecs && (
                <div className="system-specs-banner">
                  <span className="system-specs-hw">
                    Phần cứng: {embeddedStatus.systemSpecs.totalMemoryGb} GB RAM ({embeddedStatus.systemSpecs.cpuCores} cores)
                  </span>
                  <span className="system-specs-reason">
                    {embeddedStatus.systemSpecs.recommendationReason}
                  </span>
                </div>
              )}

              {/* Model Selection Options */}
              <div className="settings-field">
                <span>Kích thước mô hình:</span>
                <div className="model-options-list">
                  {(Object.values(EMBEDDED_MODELS)).map((m) => {
                    const isSelected = embeddedModel === m.id;
                    const isRecommended = embeddedStatus.systemSpecs?.suggestedModelId === m.id;
                    const isDownloaded = embeddedStatus.downloadedModels?.[m.id] ?? false;
                    const isDownloadingThis =
                      embeddedStatus.status === 'downloading' &&
                      (embeddedStatus.modelId === m.id || (!embeddedStatus.modelId && isSelected));

                    return (
                      <div
                        key={m.id}
                        className={`model-option-card ${isSelected ? 'model-option-active' : ''}`}
                        onClick={() => setEmbeddedModel(m.id)}
                      >
                        <div className="model-option-header">
                          <div className="model-option-title">
                            {m.name}
                            <span className="model-param-badge">{m.paramSize}</span>
                          </div>
                          <div className="model-badges">
                            {isRecommended && (
                              <span className="model-recommend-badge">Khuyên dùng</span>
                            )}
                            {isDownloadingThis ? (
                              <span className="model-status-badge" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                                {embeddedStatus.progress}%
                              </span>
                            ) : isDownloaded ? (
                              <span className="model-status-badge downloaded">Đã tải</span>
                            ) : (
                              <span className="model-status-badge not-downloaded">{m.formattedSize}</span>
                            )}
                          </div>
                        </div>
                        <div className="model-option-desc">{m.description}</div>
                        <div className="model-option-meta">
                          Yêu cầu RAM: {m.recommendedMinRamGb} GB • Dung lượng: {m.formattedSize}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Active Model Status & Action */}
              {(() => {
                const currentOption = EMBEDDED_MODELS[embeddedModel] || EMBEDDED_MODELS['qwen2.5-0.5b'];
                const isCurrentDownloaded = embeddedStatus.downloadedModels?.[embeddedModel] ?? false;
                const isCurrentDownloading =
                  embeddedStatus.status === 'downloading' &&
                  (embeddedStatus.modelId === embeddedModel || (!embeddedStatus.modelId && embeddedModel === (settings.embeddedModel || 'qwen2.5-0.5b')));

                return (
                  <div>
                    <div className="model-action-bar">
                      <div className="model-action-status">
                        {isCurrentDownloaded ? (
                          <span className="settings-success" style={{ margin: 0 }}>
                            Sẵn sàng hoạt động
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-placeholder)' }}>
                            Chưa có file mô hình
                          </span>
                        )}
                      </div>

                      {!isCurrentDownloaded && !isCurrentDownloading && (
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ padding: '5px 12px', fontSize: '12px' }}
                          onClick={() => onDownloadEmbeddedModel(embeddedModel)}
                        >
                          Tải model ({currentOption.formattedSize})
                        </button>
                      )}
                    </div>

                    {isCurrentDownloading && (
                      <div style={{ marginTop: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span>Đang tải {currentOption.name}…</span>
                          <span>
                            {embeddedStatus.progress}%
                            {embeddedStatus.totalBytes ? ` (${formatBytes(embeddedStatus.downloadedBytes)} / ${formatBytes(embeddedStatus.totalBytes)})` : ''}
                          </span>
                        </div>
                        <div style={{ width: '100%', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${embeddedStatus.progress || 0}%`,
                              height: '100%',
                              background: 'var(--accent)',
                              transition: 'width 0.2s',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {embeddedStatus.error && (
                      <div className="settings-error" style={{ marginTop: '8px' }}>
                        {embeddedStatus.error}
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 8px' }}
                          onClick={() => onDownloadEmbeddedModel(embeddedModel)}
                        >
                          Thử lại
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {llmProvider === 'ollama' && (
            <div className="ollama-settings-block" style={{ marginTop: '12px' }}>
              <label className="settings-field">
                Mode
                <div className="theme-toggle">
                  {(['local', 'cloud'] as const).map((m) => (
                    <button
                      key={m}
                      className={`theme-option ${ollamaMode === m ? 'theme-option-active' : ''}`}
                      onClick={() => handleModeSwitch(m)}
                      type="button"
                    >
                      {m === 'local' ? 'Local Daemon' : 'Ollama Cloud'}
                    </button>
                  ))}
                </div>
              </label>
              <label className="settings-field">
                Base URL
                <div className="field-row">
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    placeholder={ollamaMode === 'cloud' ? CLOUD_BASE_URL : 'http://localhost:11434'}
                  />
                  <button className="btn-secondary" onClick={handleTest} disabled={ollamaChecking}>
                    {ollamaChecking ? 'Testing...' : 'Test'}
                  </button>
                </div>
              </label>
              {ollamaMode === 'cloud' && (
                <label className="settings-field">
                  API Key
                  <div className="field-row">
                    <input
                      type="password"
                      value={ollamaApiKey}
                      onChange={(e) => setOllamaApiKey(e.target.value)}
                      placeholder="Ollama Cloud API key"
                    />
                  </div>
                </label>
              )}
              {ollamaChecking && (
                <div className="settings-info">Checking connection…</div>
              )}
              {!ollamaChecking && ollamaConnected && (
                <div className="settings-success">Connected — {ollamaModels.length} model(s) available</div>
              )}
              {!ollamaChecking && !ollamaConnected && ollamaError && (
                <div className="settings-error">{ollamaError}</div>
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
            </div>
          )}
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
