import type { OllamaStatus, EmbeddedModelStatus, LlmProvider } from '../../shared/types';

interface Props {
  llmProvider: LlmProvider;
  embedded: EmbeddedModelStatus;
  ollama: OllamaStatus;
  githubChecked: boolean;
  githubUser: string | null;
  onOpenSettings: () => void;
}

export default function StatusBar({
  llmProvider,
  embedded,
  ollama,
  githubChecked,
  githubUser,
  onOpenSettings,
}: Props) {
  const isEmbedded = llmProvider === 'embedded';

  let aiConnected = false;
  let aiLabel = '';
  let showAiAction = false;
  let aiActionLabel = 'Configure';

  if (isEmbedded) {
    if (embedded.status === 'ready') {
      aiConnected = true;
      aiLabel = 'LLM';
    } else if (embedded.status === 'downloading') {
      aiConnected = false;
      aiLabel = `AI: Downloading (${embedded.progress ?? 0}%)`;
    } else if (embedded.status === 'loading') {
      aiConnected = false;
      aiLabel = 'AI: Loading model…';
    } else if (embedded.status === 'not_downloaded') {
      aiConnected = false;
      aiLabel = 'AI: Model not downloaded';
      showAiAction = true;
      aiActionLabel = 'Download';
    } else {
      aiConnected = false;
      aiLabel = 'AI: Model error';
      showAiAction = true;
      aiActionLabel = 'Check';
    }
  } else {
    aiConnected = ollama.connected;
    aiLabel = `Ollama: ${ollama.connected ? 'Connected' : 'Disconnected'}`;
    showAiAction = !ollama.connected;
    aiActionLabel = 'Configure';
  }

  return (
    <div className="status-bar">
      <div className={`status-indicator ${aiConnected ? 'connected' : 'disconnected'}`}>
        <span className="status-dot" />
        <span>{aiLabel}</span>
        {showAiAction && (
          <button className="status-action" onClick={onOpenSettings}>
            {aiActionLabel}
          </button>
        )}
      </div>
      <div className={`status-indicator ${githubChecked && githubUser ? 'connected' : 'disconnected'}`}>
        <span className="status-dot" />
        <span>GitHub: {githubUser ? `✓ ${githubUser}` : githubChecked ? 'Invalid token' : 'Not configured'}</span>
        {!githubUser && (
          <button className="status-action" onClick={onOpenSettings}>Set token</button>
        )}
      </div>
    </div>
  );
}
