import { useState, type FormEvent } from 'react';
import { MAX_NAME_LENGTH } from '@shared/protocol';

interface Props {
  title: string;
  submitLabel: string;
  initialName?: string;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}

export function NameModal({ title, submitLabel, initialName = '', onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-modal-title"
        onSubmit={submit}
      >
        <h2 id="name-modal-title" className="modal__title">
          {title}
        </h2>
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="input"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="modal__actions">
          {onCancel && (
            <button type="button" className="button button--secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="button button--primary" disabled={!trimmed}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
