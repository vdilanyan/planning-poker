import { useState, type FormEvent } from 'react';
import { generateRoomId } from '@shared/room-id';
import { ThemeToggle } from './components/ThemeToggle';
import { extractRoomId, navigate, roomPath } from './route';
import type { Theme } from './theme';

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
}

export function Landing({ theme, onToggleTheme }: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createRoom = () => navigate(roomPath(generateRoomId()));

  const join = (event: FormEvent) => {
    event.preventDefault();
    const roomId = extractRoomId(input);
    if (!roomId) {
      setError("That doesn't look like a room link or code.");
      return;
    }
    setError(null);
    navigate(roomPath(roomId));
  };

  return (
    <div className="page">
      <div className="landing__top">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <main className="landing">
        <img className="header__logo landing__logo" src="/logo.svg" alt="" />
        <h1 className="landing__title">Planning Poker</h1>
        <p className="landing__text">
          Estimate together. Create a room, share its link, and everyone votes in secret.
        </p>
        <button type="button" className="button button--primary" onClick={createRoom}>
          Create room
        </button>

        <form className="landing__join" onSubmit={join}>
          <label className="field">
            <span className="field__label">Paste a room link or code</span>
            <input
              className="input"
              value={input}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'join-error' : undefined}
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
            />
          </label>
          {error && (
            <p id="join-error" className="landing__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button button--secondary">
            Join
          </button>
        </form>
      </main>
    </div>
  );
}
