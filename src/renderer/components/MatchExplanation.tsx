import type { RelevanceScore } from '../../shared/types';

interface Props {
  explanation: string;
  score: RelevanceScore;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-bar-row">
      <span className="score-bar-label">{label}</span>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="score-bar-value">{Math.round(value * 100)}</span>
    </div>
  );
}

export default function MatchExplanation({ explanation, score }: Props) {
  return (
    <div className="match-explanation">
      <p className="match-text">{explanation}</p>
      <div className="score-breakdown">
        <ScoreBar label="Semantic" value={score.semanticMatch} />
        <ScoreBar label="Stars" value={score.starsScore} />
        <ScoreBar label="Activity" value={score.activityScore} />
        <ScoreBar label="README" value={score.readmeRelevance} />
        <ScoreBar label="Language" value={score.languageMatch} />
        <ScoreBar label="License" value={score.licenseCompatibility} />
      </div>
      <div className="total-score">
        Relevance: <strong>{Math.round(score.total * 100)}%</strong>
      </div>
    </div>
  );
}
