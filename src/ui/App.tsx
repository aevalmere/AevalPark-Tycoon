import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import type { GameSession, SessionInit } from '../game/session';
import { MainMenu } from './screens/MainMenu';

// Everything past the menu pulls in the map engine and the simulation. Loading
// it on demand lets the menu paint first; it is fetched in the background
// straight after, so the buttons never wait on it.
const screens = {
  game: () => import('./screens/GameScreen'),
  loading: () => import('./screens/Loading'),
  newGame: () => import('./screens/NewGame'),
};
const GameScreen = lazy(() => screens.game().then((m) => ({ default: m.GameScreen })));
const Loading = lazy(() => screens.loading().then((m) => ({ default: m.Loading })));
const NewGame = lazy(() => screens.newGame().then((m) => ({ default: m.NewGame })));

type Screen =
  | { name: 'menu' }
  | { name: 'new' }
  | { name: 'loading'; init: SessionInit }
  | { name: 'game'; session: GameSession };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const toMenu = useCallback(() => setScreen({ name: 'menu' }), []);
  const start = useCallback((init: SessionInit) => setScreen({ name: 'loading', init }), []);

  useEffect(() => {
    const t = setTimeout(() => { void screens.newGame(); void screens.loading(); void screens.game(); }, 400);
    return () => clearTimeout(t);
  }, []);

  if (screen.name === 'menu') return <MainMenu onNew={() => setScreen({ name: 'new' })} onStart={start} />;
  return (
    <Suspense fallback={<div className="boot" />}>
      {screen.name === 'new' && <NewGame onBack={toMenu} onStart={start} />}
      {screen.name === 'loading' && <Loading init={screen.init} onReady={(session) => setScreen({ name: 'game', session })} onFail={toMenu} />}
      {screen.name === 'game' && <GameScreen session={screen.session} onQuit={toMenu} />}
    </Suspense>
  );
}
