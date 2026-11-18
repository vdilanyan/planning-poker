import type { Row } from '@shared/types';
import { MiniCard } from './MiniCard';

interface Props {
  rows: Row[];
  revealed: boolean;
}

export function VoteTable({ rows, revealed }: Props) {
  return (
    <table className="votes">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col" className="votes__vote">
            Vote
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={row.online ? undefined : 'votes__row--offline'}>
            <td>
              {row.name}
              {!row.online && <span className="votes__offline"> (offline)</span>}
            </td>
            <td className="votes__vote">
              {row.hasVoted ? (
                <MiniCard revealed={revealed} value={row.value} />
              ) : (
                <span className="mini-card mini-card--empty" aria-label="Not voted" />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
