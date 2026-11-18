import { useEffect, useState } from 'react';

/** Keep in sync with --transition-hover in styles/tokens.css. */
const FLIP_MS = 250;

interface Props {
  revealed: boolean;
  /** Only present while revealed; the server never sends it before. */
  value: number | null | undefined;
}

/**
 * A voted card that flips between its face-down (striped back) and face-up (number) sides.
 * The element stays mounted across reveal/hide so the CSS transition can run. The number is
 * kept in the DOM only for the duration of the flip back, then removed again.
 */
export function MiniCard({ revealed, value }: Props) {
  const [lingering, setLingering] = useState<number | null | undefined>(value);

  useEffect(() => {
    if (value !== undefined) {
      setLingering(value);
      return;
    }
    const timer = setTimeout(() => setLingering(undefined), FLIP_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const shown = value ?? lingering;

  return (
    <span className={`flip${revealed ? ' flip--revealed' : ''}`}>
      <span className="flip__inner">
        <span
          className="mini-card mini-card--back flip__face"
          aria-label={revealed ? undefined : 'Voted'}
          aria-hidden={revealed ? true : undefined}
        />
        <span
          className="mini-card mini-card--front flip__face flip__face--front"
          aria-hidden={revealed ? undefined : true}
        >
          {shown}
        </span>
      </span>
    </span>
  );
}
