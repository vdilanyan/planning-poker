import type { MouseEvent } from 'react';
import { navigate } from '../route';
import type { Theme } from '../theme';
import { CopyLinkButton } from './CopyLinkButton';
import { ThemeToggle } from './ThemeToggle';

interface Props {
  name: string;
  onChangeName: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Header({ name, onChangeName, theme, onToggleTheme }: Props) {
  // Plain clicks navigate in-app; modified clicks keep the normal link behaviour (new tab, etc).
  const goHome = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate('/');
  };

  return (
    <header className="header">
      <a className="header__brand" href="/" onClick={goHome}>
        <img className="header__logo" src="/logo.svg" alt="" />
        <h1 className="header__title">Planning Poker</h1>
      </a>
      <div className="header__user">
        <span>{name}</span>
        <button type="button" className="link-button" onClick={onChangeName}>
          Not you? Change name
        </button>
        <CopyLinkButton />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </header>
  );
}
