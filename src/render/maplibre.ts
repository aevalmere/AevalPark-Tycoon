// MapLibre v6 finds its tile worker by computing a URL next to its own module
// at runtime, which bundlers can't see. Point it at the worker explicitly so
// both the dev server and the production build ship it.

import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
