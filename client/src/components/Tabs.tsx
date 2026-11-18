import type { KeyboardEvent } from 'react';
import { TABS, type Tab } from '@shared/types';
import { TAB_TEXT } from '../labels';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

export function Tabs({ active, onChange }: Props) {
  const onKeyDown = (event: KeyboardEvent) => {
    const index = TABS.indexOf(active);
    let next: Tab | null = null;
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
    if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length];
    if (next) {
      onChange(next);
      document.getElementById(`tab-${next}`)?.focus();
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label="Voting" onKeyDown={onKeyDown}>
      {TABS.map((tab) => (
        <button
          key={tab}
          id={`tab-${tab}`}
          type="button"
          role="tab"
          aria-selected={tab === active}
          aria-controls={`panel-${tab}`}
          tabIndex={tab === active ? 0 : -1}
          className={`tab${tab === active ? ' tab--active' : ''}`}
          onClick={() => onChange(tab)}
        >
          {TAB_TEXT[tab].label}
        </button>
      ))}
    </div>
  );
}
