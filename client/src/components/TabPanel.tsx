import { DECKS, type ClientMessage, type Tab, type TabView } from '@shared/types';
import { TAB_TEXT } from '../labels';
import { CardDeck } from './CardDeck';
import { StatsTile } from './StatsTile';
import { VoteTable } from './VoteTable';

interface Props {
  tab: Tab;
  view: TabView;
  send: (message: ClientMessage) => void;
  /** Controls are disabled while disconnected, because send() would drop the message. */
  connected: boolean;
}

export function TabPanel({ tab, view, send, connected }: Props) {
  const text = TAB_TEXT[tab];
  const voted = view.rows.filter((row) => row.hasVoted).length;

  return (
    <section className="panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      <h2 className="panel__heading">{text.heading}</h2>
      <p className="panel__hint">{text.hint}</p>

      <CardDeck
        deck={DECKS[tab]}
        selected={view.myVote}
        disabled={view.revealed || !connected}
        onSelect={(value) => send({ type: 'vote', tab, value })}
      />

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!connected}
          onClick={() => send({ type: view.revealed ? 'hide' : 'reveal', tab })}
        >
          {view.revealed ? 'Hide' : 'Reveal'}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={!connected}
          onClick={() => send({ type: 'reset', tab })}
        >
          Delete Estimates
        </button>
        <span className="actions__count">
          {voted} of {view.rows.length} voted
        </span>
      </div>

      {tab === 'confidence' && view.stats && <StatsTile stats={view.stats} prominent />}

      <VoteTable rows={view.rows} revealed={view.revealed} />
    </section>
  );
}
