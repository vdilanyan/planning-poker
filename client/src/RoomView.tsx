import { useState } from 'react';
import type { Tab } from '@shared/types';
import { Header } from './components/Header';
import { TabPanel } from './components/TabPanel';
import { Tabs } from './components/Tabs';
import type { User } from './identity';
import type { Theme } from './theme';
import type { RoomConnection } from './useRoom';

interface Props {
  user: User;
  room: RoomConnection;
  onChangeName: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function RoomView({ user, room, onChangeName, theme, onToggleTheme }: Props) {
  const [active, setActive] = useState<Tab>('poker');
  const view = room.state?.tabs[active];

  return (
    <div className="page">
      <Header
        name={user.name}
        onChangeName={onChangeName}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      {!room.connected && (
        <div className="banner" role="status">
          Connecting to the room…
        </div>
      )}
      <Tabs active={active} onChange={setActive} />
      {view && (
        <TabPanel
          key={active}
          tab={active}
          view={view}
          send={room.send}
          connected={room.connected}
        />
      )}
    </div>
  );
}
