import { useCallback, useLayoutEffect, useState } from 'react';

export type Theme = 'gui' | 'tui';

export const THEME_KEY = 'planning-poker.theme';

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'tui' ? 'tui' : 'gui';
  } catch {
    return 'gui';
  }
}

function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable (private mode, quota): the theme just won't be remembered.
  }
}

/** Current theme, applied as `data-theme` on <html> (before paint), remembered in the browser. */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(() => loadTheme());

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'tui' ? 'gui' : 'tui'));
  }, []);

  return { theme, toggleTheme };
}
