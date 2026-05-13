interface Props {
  bookmarked: boolean;
  onClick: (e: React.MouseEvent) => void;
}

export default function BookmarkButton({ bookmarked, onClick }: Props) {
  return (
    <button
      className={`bookmark-btn ${bookmarked ? 'bookmarked' : ''}`}
      onClick={onClick}
      title={bookmarked ? 'Remove bookmark' : 'Bookmark this repo'}
    >
      <svg viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" width="14" height="14">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
