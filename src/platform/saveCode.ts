// Save codes: the save JSON, deflated and base64url-encoded behind a version
// prefix, so a whole company fits in a string you can paste into chat.

import type { GameState } from '../sim/state';
import { migrate } from '../sim/setup';

const PREFIX = 'APT1.';

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeSave(state: GameState): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(state));
  return PREFIX + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeSave(code: string): Promise<GameState> {
  const trimmed = code.trim().replace(/\s+/g, '');
  if (!trimmed.startsWith(PREFIX)) throw new Error("That doesn't look like an AevalPark save code.");
  let state: GameState;
  try {
    const bytes = await pipe(fromBase64Url(trimmed.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    state = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The save code is damaged or incomplete.');
  }
  if (!state || typeof state !== 'object' || !state.meta?.origin || !state.companies) throw new Error('The save code is missing game data.');
  return migrate(state);
}
