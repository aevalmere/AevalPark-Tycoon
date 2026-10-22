import { useCallback, useState } from 'react';
import type { GameSession, SessionInit } from '../game/session';
import { GameScreen } from './screens/GameScreen';
import { Loading } from './screens/Loading';
import { MainMenu } from './screens/MainMenu';
import { NewGame } from './screens/NewGame';

type Screen =
  | { name: 'menu' }
  | { name: 'new' }
  | { name: 'loading'; init: SessionInit }
  | { name: 'game'; session: GameSession };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const toMenu = useCallback(() => setScreen({ name: 'menu' }), []);
  const start = useCallback((init: SessionInit) => setScreen({ name: 'loading', init }), []);

  switch (screen.name) {
    case 'menu':
      return <MainMenu onNew={() => setScreen({ name: 'new' })} onStart={start} />;
    case 'new':
      return <NewGame onBack={toMenu} onStart={start} />;
    case 'loading':
      return <Loading init={screen.init} onReady={(session) => setScreen({ name: 'game', session })} onFail={toMenu} />;
    case 'game':
      return <GameScreen session={screen.session} onQuit={toMenu} />;
  }
}
