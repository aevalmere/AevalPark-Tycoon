import type { ReactNode } from 'react';
import { PARK_WALK_RADIUS } from '../../sim/balance';
import { Button } from '../components';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useGame } from './context';

export function Tutorial() {
  const { ui, session, act, focus } = useGame();
  const step = useStore(ui, (s) => s.hud.tutorial);
  useStore(ui, (s) => s.tick);
  if (step < 0) return null;
  const sim = session.sim;
  const scripted = Object.values(sim.state.trips).find((t) => t.scripted);
  const o = scripted ? sim.wb(scripted.origin) : undefined;
  const d = scripted ? sim.wb(scripted.dest) : undefined;
  const hq = sim.world.buildings[sim.world.hq];
  const next = (n: number) => act({ type: 'tutorial', step: n });

  let title = '', body: ReactNode = null, actions: ReactNode = null;
  switch (step) {
    case 0:
      title = `Welcome to ${sim.state.meta.company}`;
      body = <>Your HQ is the gold building at <b>{hq.name}</b>. The buildings around it are full of people who need to get places. Your job: get them there.</>;
      actions = <Button variant="primary" size="sm" onClick={() => next(1)}>Let's go</Button>;
      break;
    case 1:
      title = 'Your first rider';
      body = o && d
        ? <>Someone at <b>{o.name}</b> needs to get to <b>{d.name}</b>, and they don't own a car. Pick the <b>Taxi depot</b> tool (key <kbd>1</kbd>) and click any building near them to open one.</>
        : <>A rider is about to call. Open a <b>Taxi depot</b> (key <kbd>1</kbd>) on any building in your service area.</>;
      actions = o && <Button size="sm" onClick={() => { focus(o.cx, o.cy, 16.6); ui.set({ tool: 'taxi' }); }}><Icon.Target size={14} /> Show me</Button>;
      break;
    case 2:
      title = 'A taxi is on its way';
      body = <>The ring around a rider's bubble is their patience. Keep an eye on it: if it runs out, they give up and your rating drops. Watch your taxi pick them up.</>;
      break;
    case 3:
      title = 'This one has a car';
      body = d
        ? <>The blue bubble is a driver. Drivers need a parking lot within {PARK_WALK_RADIUS} m of <b>{d.name}</b>. Pick the <b>Parking</b> tool (<kbd>2</kbd>) and convert a building next to it.</>
        : <>Drivers need a parking lot near where they're going. Use the <b>Parking</b> tool (<kbd>2</kbd>).</>;
      actions = d && <Button size="sm" onClick={() => { focus(d.cx, d.cy, 16.8); ui.set({ tool: 'parking' }); }}><Icon.Target size={14} /> Show me</Button>;
      break;
    case 4:
      title = 'Watch the traffic';
      body = <>Streets are coloured by congestion. Taxis that drop riders at the kerb block a lane for a few minutes, so every car on that street slows down. A parking lot near the destination works as a drop-off zone without slowing anyone.</>;
      actions = <Button variant="primary" size="sm" onClick={() => next(5)}>Got it</Button>;
      break;
    case 5:
      title = "You're open for business";
      body = <>From here the city calls on its own, and more buildings join as riders tell their friends. <b>Dealerships</b> sell cars to nearby customers. Check <b>Goals</b> for rewards, and expand your service area when you're ready.</>;
      actions = <Button variant="primary" size="sm" onClick={() => next(-1)}>Start playing</Button>;
      break;
  }

  return (
    <section className="tutorial" aria-label="Tutorial">
      <div className="tutorial-step">Step {step + 1} of 6</div>
      <h3>{title}</h3>
      <p>{body}</p>
      <div className="tutorial-actions">
        {actions}
        <button type="button" className="link-btn" onClick={() => next(-1)}>Skip tutorial</button>
      </div>
    </section>
  );
}
