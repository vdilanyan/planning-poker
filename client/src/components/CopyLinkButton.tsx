import { useEffect, useRef, useState } from 'react';
import { copyText } from '../copy';

const FEEDBACK_MS = 2000;

type Status = 'idle' | 'copied' | 'manual';

export function CopyLinkButton() {
  const [status, setStatus] = useState<Status>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const manualInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (status === 'manual') manualInput.current?.select();
  }, [status]);

  const onClick = async () => {
    const ok = await copyText(window.location.href);
    clearTimeout(timer.current);
    if (ok) {
      setStatus('copied');
      timer.current = setTimeout(() => setStatus('idle'), FEEDBACK_MS);
    } else {
      // Nothing could write to the clipboard: show the link, selected, so it can be copied by hand.
      setStatus('manual');
    }
  };

  return (
    <>
      <button type="button" className="button button--secondary header__toggle" onClick={onClick}>
        {status === 'copied' ? 'Link copied' : 'Copy link'}
      </button>
      {status === 'manual' && (
        <input
          ref={manualInput}
          className="input header__link"
          readOnly
          aria-label="Room link"
          value={window.location.href}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </>
  );
}
