import { formatAverage } from '@shared/stats';
import type { Stats } from '@shared/types';

interface Props {
  stats: Stats;
  prominent: boolean;
}

export function StatsTile({ stats, prominent }: Props) {
  return (
    <div className={`stats${prominent ? ' stats--prominent' : ''}`}>
      <div className="stats__average">
        <span className="stats__label">Average</span>
        <span className="stats__value" data-testid="average">
          {formatAverage(stats.average)}
        </span>
      </div>
      <dl className="stats__details">
        <div>
          <dt>Votes</dt>
          <dd>{stats.count}</dd>
        </div>
        <div>
          <dt>Min</dt>
          <dd>{stats.min ?? '—'}</dd>
        </div>
        <div>
          <dt>Max</dt>
          <dd>{stats.max ?? '—'}</dd>
        </div>
      </dl>
    </div>
  );
}
