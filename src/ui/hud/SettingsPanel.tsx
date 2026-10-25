import { useState } from 'react';
import { sfx } from '../../platform/audio';
import { loadSettings, saveSettings, type Settings } from '../../platform/storage';
import { Segmented, Toggle } from '../components';

export function SettingsContent({ onChange, inGame }: { onChange?: (s: Settings) => void; inGame?: boolean }) {
  const [s, setS] = useState(loadSettings);
  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
    sfx.enabled = next.sound;
    sfx.volume = next.volume;
    onChange?.(next);
  };
  return (
    <div className="settings">
      <div className="field-row">
        <span className="field-label">Map style</span>
        <Segmented label="Map style" value={s.mapStyle} onChange={(v) => update({ mapStyle: v })}
          options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </div>
      {inGame && <p className="hint">The map style applies the next time you load a company.</p>}
      <div className="field-row">
        <span className="field-label">Graphics</span>
        <Segmented label="Graphics" value={s.graphics} onChange={(v) => update({ graphics: v })}
          options={[
            { value: 'high', label: 'High', title: 'Full resolution on sharp screens' },
            { value: 'balanced', label: 'Balanced', title: 'Caps resolution on high-DPI screens' },
            { value: 'low', label: 'Fast', title: 'Lowest resolution, no shadows, glows or antialiasing' },
          ]} />
      </div>
      <p className="hint">If the city stutters, try Fast.{inGame ? ' Resolution changes now; antialiasing on your next load.' : ''}</p>
      <Toggle label="Show frame rate" checked={s.showFps} onChange={(v) => update({ showFps: v })} />
      <Toggle label="Day and night cycle" checked={s.dayNight} onChange={(v) => update({ dayNight: v })} />
      <Toggle label="Sound effects" checked={s.sound} onChange={(v) => { update({ sound: v }); if (v) sfx.play('coin'); }} />
      <div className="field-row">
        <label className="field-label" htmlFor="vol">Volume</label>
        <input id="vol" type="range" min={0} max={1} step={0.05} value={s.volume} disabled={!s.sound}
          onChange={(e) => update({ volume: Number(e.target.value) })} onPointerUp={() => sfx.play('coin')} />
      </div>
      <div className="field-row">
        <span className="field-label">Units</span>
        <Segmented label="Units" value={s.units} onChange={(v) => update({ units: v })}
          options={[{ value: 'metric', label: 'Metres' }, { value: 'imperial', label: 'Feet / miles' }]} />
      </div>
      <Toggle label="Autosave every game day" checked={s.autosave} onChange={(v) => update({ autosave: v })} />
    </div>
  );
}
