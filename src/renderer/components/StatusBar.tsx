import type { OllamaStatus } from '../../shared/types';

interface Props {
  ollama: OllamaStatus;
  githubChecked: boolean;
  githubUser: string | null;
  onOpenSettings: () => void;
}

export default function StatusBar({ ollama, githubChecked, githubUser, onOpenSettings }: Props) {
  return (
    <div className="status-bar">
      <div className={`status-indicator ${ollama.connected ? 'connected' : 'disconnected'}`}>
        <span className="status-dot" />
        <span>Ollama: {ollama.connected ? 'Connected' : 'Disconnected'}</span>
        {!ollama.connected && (
          <button className="status-action" onClick={onOpenSettings}>Configure</button>
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
