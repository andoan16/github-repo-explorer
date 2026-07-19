import { useState, useEffect, useRef } from 'react';
import type { SearchFilters } from '../../shared/types';

interface Props {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  disabled: boolean;
  filtersChanged: boolean;
  onApply: () => void;
}

const LANGUAGES = [
  '', 'javascript', 'typescript', 'python', 'rust', 'go', 'java', 'c++', 'c#',
  'ruby', 'swift', 'kotlin', 'php', 'elixir', 'haskell', 'scala', 'lua', 'zig',
];

const LICENSES = [
  '', 'mit', 'apache-2.0', 'gpl-3.0', 'bsd-3-clause', 'mpl-2.0',
];

function formatMinStars(n: number): string {
  return n === 0 ? '' : String(n);
}

export default function Filters({ filters, onChange, disabled, filtersChanged, onApply }: Props) {
  const set = (key: keyof SearchFilters, value: string | number | null) => {
    onChange({ ...filters, [key]: value });
  };

  // Local string state for minStars so the user can type freely
  // (e.g. clear the field, type "15000" without seeing "015000")
  const [minStarsText, setMinStarsText] = useState(formatMinStars(filters.minStars));
  // Track the last known parent value so we can sync when it changes externally
  const lastParentMinStars = useRef(filters.minStars);
  useEffect(() => {
    if (filters.minStars !== lastParentMinStars.current) {
      lastParentMinStars.current = filters.minStars;
      setMinStarsText(formatMinStars(filters.minStars));
    }
  }, [filters.minStars]);

  const handleMinStarsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Only allow digits (no leading zeros except for bare "0")
    if (raw === '' || raw === '0' || /^[1-9]\d*$/.test(raw)) {
      setMinStarsText(raw);
      const parsed = raw === '' ? 0 : parseInt(raw, 10);
      set('minStars', parsed);
    }
    // Silently reject invalid input (leading zeros like "015000", negatives, decimals)
  };

  const handleMinStarsBlur = () => {
    // On blur, normalize: if empty or invalid, reset to 0 and clear the text field
    const parsed = parseInt(minStarsText, 10);
    if (isNaN(parsed) || parsed < 0) {
      setMinStarsText('');
      set('minStars', 0);
    }
    // Otherwise keep what the user typed
  };

  return (
    <div className="filters">
      <label className="filter-label">
        Language
        <select
          value={filters.language ?? ''}
          onChange={(e) => set('language', e.target.value || null)}
          disabled={disabled}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>{l || 'Any'}</option>
          ))}
        </select>
      </label>
      <label className="filter-label">
        License
        <select
          value={filters.license ?? ''}
          onChange={(e) => set('license', e.target.value || null)}
          disabled={disabled}
        >
          {LICENSES.map((l) => (
            <option key={l} value={l}>{l || 'Any'}</option>
          ))}
        </select>
      </label>
      <label className="filter-label">
        Min stars
        <input
          className="min-stars-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="Any"
          value={minStarsText}
          onChange={handleMinStarsChange}
          onBlur={handleMinStarsBlur}
          disabled={disabled}
        />
      </label>
      {filtersChanged && (
        <button
          className="btn-primary filter-apply-btn"
          disabled={disabled}
          onClick={onApply}
        >
          Apply Filters
        </button>
      )}
    </div>
  );
}