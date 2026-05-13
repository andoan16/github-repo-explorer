import type { SearchFilters } from '../../shared/types';

interface Props {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  disabled: boolean;
}

const LANGUAGES = [
  '', 'javascript', 'typescript', 'python', 'rust', 'go', 'java', 'c++', 'c#',
  'ruby', 'swift', 'kotlin', 'php', 'elixir', 'haskell', 'scala', 'lua', 'zig',
];

const LICENSES = [
  '', 'mit', 'apache-2.0', 'gpl-3.0', 'bsd-3-clause', 'mpl-2.0',
];

export default function Filters({ filters, onChange, disabled }: Props) {
  const set = (key: keyof SearchFilters, value: string | number | null) => {
    onChange({ ...filters, [key]: value });
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
          type="number"
          min={0}
          max={100000}
          value={filters.minStars}
          onChange={(e) => set('minStars', parseInt(e.target.value, 10) || 0)}
          disabled={disabled}
        />
      </label>
    </div>
  );
}
