import { useEffect, useRef, useState } from 'react';
import { Marker, type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import { LocalProjection, type LatLng } from '../../core/geo';
import type { SessionInit } from '../../game/session';
import { FEATURED, locateMe, placeName, searchPlaces, type Place } from '../../platform/geo';
import { firstFreeSlot, listSlots, SLOT_COUNT } from '../../platform/storage';
import { createCityMap } from '../../render/preview';
import { DIFFICULTY, SERVICE_LEVELS, WORLD_RADIUS, type Difficulty } from '../../sim/balance';
import { Button, Segmented } from '../components';
import { randomCompany } from '../format';
import { Icon } from '../icons';

function ring(c: LatLng, r: number) {
  const p = new LocalProjection(c);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(p.toLngLat(Math.cos(a) * r, Math.sin(a) * r)); }
  return pts;
}

export function NewGame({ onBack, onStart }: { onBack: () => void; onStart: (i: SessionInit) => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const [loc, setLoc] = useState<(LatLng & { label: string }) | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [company, setCompany] = useState(randomCompany);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [slot, setSlot] = useState(firstFreeSlot);
  const slots = listSlots();

  useEffect(() => {
    let alive = true;
    const f = FEATURED[0];
    createCityMap(mapEl.current!, { style: 'light', center: [f.lng, f.lat], zoom: 14.6, pitch: 45, bearing: -12, interactive: true })
      .then((m) => {
        if (!alive) { m.remove(); return; }
        map.current = m;
        m.addSource('district', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'district-fill', type: 'fill', source: 'district', filter: ['==', ['get', 'k'], 'world'], paint: { 'fill-color': '#e8a33d', 'fill-opacity': 0.07 } });
        m.addLayer({ id: 'district-line', type: 'line', source: 'district', paint: { 'line-color': '#e8a33d', 'line-width': ['case', ['==', ['get', 'k'], 'world'], 2, 1.5], 'line-dasharray': [3, 2] } });
        m.on('click', (e) => choose({ lat: e.lngLat.lat, lng: e.lngLat.lng }, null));
      })
      .catch(() => setErr('The map preview could not load. You can still search for an address.'));
    return () => { alive = false; map.current?.remove(); map.current = null; };
  }, []);

  // debounced address search
  useEffect(() => {
    if (query.trim().length < 3) { setResults([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(query, ctl.signal).then(setResults).catch((e) => { if ((e as Error).name !== 'AbortError') setErr((e as Error).message); });
    }, 380);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query]);

  const choose = async (p: LatLng, label: string | null) => {
    setErr(null);
    setResults([]);
    const m = map.current;
    if (m) {
      if (!marker.current) {
        const el = document.createElement('div');
        el.className = 'hq-pin';
        el.innerHTML = '<svg viewBox="0 0 64 64" width="26" height="26"><path d="M13 44 L13 25 L23.5 33.5 L32 19 L40.5 33.5 L51 25 L51 44 Z" fill="#fff"/><rect x="13" y="47" width="38" height="4.5" rx="2.25" fill="#fff"/></svg>';
        marker.current = new Marker({ element: el, anchor: 'bottom' });
      }
      marker.current.setLngLat([p.lng, p.lat]).addTo(m);
      (m.getSource('district') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { k: 'world' }, geometry: { type: 'Polygon', coordinates: [ring(p, WORLD_RADIUS)] } },
          { type: 'Feature', properties: { k: 'service' }, geometry: { type: 'Polygon', coordinates: [ring(p, SERVICE_LEVELS[0].radius)] } },
        ],
      });
      m.flyTo({ center: [p.lng, p.lat], zoom: 15.2, pitch: 50, duration: 1200, essential: true });
    }
    setLoc({ ...p, label: label ?? 'Locating…' });
    if (!label) {
      const name = await placeName(p);
      setLoc((cur) => (cur && cur.lat === p.lat && cur.lng === p.lng ? { ...cur, label: name } : cur));
    }
  };

  const useMine = async () => {
    setBusy('locate');
    setErr(null);
    try { await choose(await locateMe(), null); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  const canStart = !!loc && loc.label !== 'Locating…' && company.trim().length > 0;

  return (
    <div className="newgame">
      <div ref={mapEl} className="newgame-map" />
      <aside className="newgame-panel">
        <button type="button" className="back-link" onClick={onBack}>← Main menu</button>
        <h1>Found a company</h1>

        <section className="step">
          <h2><span className="step-n">1</span> Where's your headquarters?</h2>
          <p className="hint">The building at this spot becomes your HQ. The game maps the real streets and buildings within {WORLD_RADIUS / 1000} km.</p>
          <Button variant="primary" onClick={useMine} disabled={busy === 'locate'}>
            <Icon.Locate size={16} /> {busy === 'locate' ? 'Finding you…' : 'Use my location'}
          </Button>
          <div className="search">
            <Icon.Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search an address or place" aria-label="Search an address or place" />
            {results.length > 0 && (
              <ul className="search-results" role="listbox">
                {results.map((r, i) => (
                  <li key={i}><button type="button" onClick={() => { setQuery(r.label); choose(r, `${r.label}${r.detail ? ', ' + r.detail.split(', ')[0] : ''}`); }}>
                    <b>{r.label}</b><span>{r.detail}</span>
                  </button></li>
                ))}
              </ul>
            )}
          </div>
          <div className="chips" aria-label="Featured cities">
            {FEATURED.map((f) => (
              <button type="button" key={f.label} className="chip" onClick={() => choose(f, `${f.label}, ${f.detail}`)}>{f.label}<span>{f.detail}</span></button>
            ))}
          </div>
          <p className="hint">Or click anywhere on the map.</p>
          {loc && <div className="chosen"><Icon.Pin size={15} /> <span>{loc.label}</span></div>}
        </section>

        <section className="step">
          <h2><span className="step-n">2</span> Name your company</h2>
          <div className="name-row">
            <input value={company} maxLength={32} onChange={(e) => setCompany(e.target.value)} aria-label="Company name" />
            <button type="button" className="icon-btn" title="Random name" aria-label="Random name" onClick={() => setCompany(randomCompany())}><Icon.Dice /></button>
          </div>
        </section>

        <section className="step">
          <h2><span className="step-n">3</span> Difficulty</h2>
          <Segmented label="Difficulty" value={difficulty} onChange={setDifficulty}
            options={(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => ({ value: d, label: DIFFICULTY[d].label }))} />
          <p className="hint">{DIFFICULTY[difficulty].blurb} Starting cash ${DIFFICULTY[difficulty].money.toLocaleString()}.</p>
        </section>

        <section className="step">
          <h2><span className="step-n">4</span> Save slot</h2>
          <div className="slot-picker">
            {Array.from({ length: SLOT_COUNT }, (_, i) => (
              <button type="button" key={i} className={`slot-pick ${slot === i ? 'on' : ''}`} onClick={() => setSlot(i)}>
                <b>Slot {i + 1}</b>
                <span>{slots[i] ? `Overwrites ${slots[i]!.company}` : 'Empty'}</span>
              </button>
            ))}
          </div>
        </section>

        {err && <p className="form-error" role="alert">{err}</p>}
        <Button variant="primary" size="lg" className="start-btn" disabled={!canStart}
          onClick={() => loc && onStart({ mode: 'new', origin: { lat: loc.lat, lng: loc.lng }, city: loc.label, company: company.trim(), difficulty, slot })}>
          Open for business
        </Button>
      </aside>
    </div>
  );
}
