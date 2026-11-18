import { useEffect, useState } from 'react';
import { NameModal } from './components/NameModal';
import { createUser, loadUser, saveUser, STORAGE_KEY, type User } from './identity';
import { RoomNotice, ROOM_ERROR_MESSAGES } from './RoomNotice';
import { RoomView } from './RoomView';
import type { Theme } from './theme';
import { useRoom } from './useRoom';

interface Props {
  roomId: string;
  theme: Theme;
  onToggleTheme: () => void;
}

/** One room. The name is global (one per browser): asked once when first entering any room. */
export function RoomPage({ roomId, theme, onToggleTheme }: Props) {
  const [user, setUser] = useState<User | null>(() => loadUser());
  const [renaming, setRenaming] = useState(false);
  const room = useRoom(user, roomId);

  // Another browser tab may rename the user; follow it so a reconnect here never rejoins
  // with the stale name. Cleared/invalid storage keeps the in-memory user (no re-prompt).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const stored = loadUser();
      if (stored) setUser(stored);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (!user) {
    return (
      <div className="page">
        <NameModal
          title="Welcome! What's your name?"
          submitLabel="Join"
          onSubmit={(name) => {
            const created = createUser(name);
            saveUser(created);
            setUser(created);
          }}
        />
      </div>
    );
  }

  if (room.error) return <RoomNotice message={ROOM_ERROR_MESSAGES[room.error]} />;

  return (
    <>
      <RoomView
        user={user}
        room={room}
        onChangeName={() => setRenaming(true)}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      {renaming && (
        <NameModal
          title="Change your name"
          submitLabel="Save"
          initialName={user.name}
          onCancel={() => setRenaming(false)}
          onSubmit={(name) => {
            const updated = { ...user, name };
            saveUser(updated);
            setUser(updated);
            room.send({ type: 'rename', name });
            setRenaming(false);
          }}
        />
      )}
    </>
  );
}
