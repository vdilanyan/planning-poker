import { isValidRoomId } from '@shared/room-id';
import { Landing } from './Landing';
import { RoomNotice, ROOM_ERROR_MESSAGES } from './RoomNotice';
import { RoomPage } from './RoomPage';
import { useRoute } from './route';
import { useTheme } from './theme';

export function App() {
  const route = useRoute();
  const { theme, toggleTheme } = useTheme();

  if (route.page === 'landing') return <Landing theme={theme} onToggleTheme={toggleTheme} />;
  if (!isValidRoomId(route.roomId)) return <RoomNotice message={ROOM_ERROR_MESSAGES.invalid} />;
  return <RoomPage key={route.roomId} roomId={route.roomId} theme={theme} onToggleTheme={toggleTheme} />;
}
