import { MAX_PARTICIPANTS_PER_ROOM } from '@shared/room-id';
import { navigate } from './route';
import type { RoomError } from './useRoom';

export const ROOM_ERROR_MESSAGES: Record<RoomError, string> = {
  invalid: "This room link isn't valid",
  full: `Room is full (${MAX_PARTICIPANTS_PER_ROOM} people)`,
  'server-full': 'Server is busy, try again later',
};

interface Props {
  message: string;
}

/** A full-page message with a way back to the landing page. */
export function RoomNotice({ message }: Props) {
  return (
    <div className="page">
      <main className="landing" role="alert">
        <h1 className="landing__title">{message}</h1>
        <button type="button" className="button button--primary" onClick={() => navigate('/')}>
          Back to start page
        </button>
      </main>
    </div>
  );
}
