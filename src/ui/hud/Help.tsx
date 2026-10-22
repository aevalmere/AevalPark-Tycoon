import { Icon } from '../icons';

export function HelpContent() {
  return (
    <div className="help">
      <section>
        <h3>The job</h3>
        <p>Your HQ sits on the building you picked. Buildings around it start calling for rides: a bubble on a rooftop is someone who needs to get across the district. Get them there before the ring around their bubble runs out, or they give up and your star rating drops.</p>
      </section>
      <section>
        <h3>Two ways to move people</h3>
        <div className="help-row"><span className="help-ico" style={{ background: '#f5b82e' }}><Icon.Taxi size={16} /></span><p><b>Taxi depots</b> send taxis to anyone without a car. Buy more taxis as demand grows. A taxi that drops someone at the kerb blocks the lane for a few minutes and slows that street.</p></div>
        <div className="help-row"><span className="help-ico" style={{ background: '#4f8cff' }}><Icon.Parking size={16} /></span><p><b>Parking lots</b> let drivers park within a short walk of where they're going. Lots double as taxi drop-off zones, so taxis using them don't slow traffic. Stack levels to turn a lot into a garage.</p></div>
        <div className="help-row"><span className="help-ico" style={{ background: '#22c7a9' }}><Icon.Key size={16} /></span><p><b>Dealerships</b> sell cars to customers nearby. More drivers means fewer taxi calls but more parking demand and more traffic.</p></div>
      </section>
      <section>
        <h3>Traffic</h3>
        <p>Every street is coloured by how congested it is, green to deep red. Cars drive slower on busy roads, so a jammed avenue makes every trip on it late. Widen roads with the road tool, and keep taxi drop-offs on lots instead of kerbs.</p>
      </section>
      <section>
        <h3>Growing</h3>
        <p>Happy riders spread the word: destinations join your network and start sending riders of their own. High ratings grow the network faster. Expand your service area when you can afford to cover more of the district.</p>
      </section>
      <section>
        <h3>Controls</h3>
        <ul className="keys">
          <li><kbd>1</kbd>–<kbd>4</kbd> taxi, parking, dealership, road tools</li>
          <li><kbd>Esc</kbd> back to select · right-click cancels a tool</li>
          <li><kbd>Space</kbd> pause · <kbd>,</kbd> <kbd>.</kbd> slower / faster</li>
          <li><kbd>T</kbd> traffic view · <kbd>G</kbd> goals</li>
          <li>Right-drag or Ctrl-drag to tilt and rotate the city</li>
        </ul>
      </section>
    </div>
  );
}
