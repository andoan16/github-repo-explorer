import React, { useState, useMemo } from 'react';

interface Props {
  onSearch: (query: string) => void;
  searching: boolean;
  disabled: boolean;
}

const SEARCH_PLACEHOLDERS = [
  'Describe what you need, e.g. "I need a self-hosted CI/CD tool with Docker support"...',
  'Mô tả nhu cầu, ví dụ "tôi muốn nền tảng CI/CD tự host hỗ trợ Docker"...',
  'Ví dụ: "quản lý mật khẩu", "giám sát máy chủ", "công cụ backup cơ sở dữ liệu"...',
];

export default function SearchBar({ onSearch, searching, disabled }: Props) {
  const [value, setValue] = useState('');
  const placeholderIdx = useMemo(() => Math.floor(Math.random() * SEARCH_PLACEHOLDERS.length), []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && !searching) onSearch(value.trim());
  };

  const placeholder = disabled
    ? 'Configure Ollama and GitHub token in Settings first...'
    : SEARCH_PLACEHOLDERS[placeholderIdx];

  return (
    <form className="search-bar" onSubmit={handleSubmit}>
      <div className="search-input-wrapper">
        <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          className="search-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={searching || disabled}
        />
        <button type="submit" className="search-button" disabled={searching || disabled || !value.trim()}>
          {searching ? (
            <span className="spinner" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
          <span>{searching ? 'Searching...' : 'Search'}</span>
        </button>
      </div>
    </form>
  );
}
