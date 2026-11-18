import type { Theme } from '../theme';

interface Props {
  theme: Theme;
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: Props) {
  return (
    <button type="button" className="button button--secondary header__toggle" onClick={onToggle}>
      {theme === 'tui' ? 'GUI mode' : 'TUI mode'}
    </button>
  );
}
