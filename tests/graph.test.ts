import { describe, expect, it } from 'vitest';
import { buildRoadGraph } from '../src/world/graph';
import type { RawLine } from '../src/world/types';

const road = (pts: number[], extra: Partial<RawLine> = {}): RawLine => ({ pts, cls: 'minor', oneway: 0, brunnel: false, layer: 0, ...extra });

function reachable(g: ReturnType<typeof buildRoadGraph>, from: number): Set<number> {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    for (const e of g.nodeOut[n]) {
      const to = g.edges[e].to;
      if (!seen.has(to)) { seen.add(to); stack.push(to); }
    }
  }
  return seen;
}

describe('buildRoadGraph', () => {
  it('splits two roads that cross without a shared vertex', () => {
    const g = buildRoadGraph([road([-100, 0, 100, 0]), road([0, -100, 0, 100])]);
    // one junction in the middle plus four ends; four links
    expect(g.nodeX.length).toBe(5);
    expect(g.links.length).toBe(4);
    expect(reachable(g, 0).size).toBe(5);
  });

  it('snaps a side street that stops just short of the main road', () => {
    const g = buildRoadGraph([road([-100, 0, 100, 0]), road([30, 1.2, 30, 80])]);
    expect(g.links.length).toBe(3);
    expect(reachable(g, 0).size).toBe(g.nodeX.length);
  });

  it('does not connect a bridge to the road underneath', () => {
    const g = buildRoadGraph([
      road([-100, 0, 100, 0]),
      road([0, -100, 0, 100], { brunnel: true, layer: 1 }),
    ]);
    // the two roads stay disconnected, so only one survives the largest-component pass
    expect(g.links.length).toBe(1);
  });

  it('respects one-way streets and drops dead-end one-ways', () => {
    // a square loop of one-way streets is strongly connected
    const loop = [
      road([0, 0, 100, 0], { oneway: 1 }),
      road([100, 0, 100, 100], { oneway: 1 }),
      road([100, 100, 0, 100], { oneway: 1 }),
      road([0, 100, 0, 0], { oneway: 1 }),
    ];
    const g = buildRoadGraph([...loop, road([100, 100, 200, 200], { oneway: 1 })]);
    expect(g.edges.length).toBe(4);
    for (const e of g.edges) expect(e.dir).toBe(1);
  });

  it('handles two dangling ends that snap onto each other', () => {
    // each road ends within snapping distance of the other's end
    const g = buildRoadGraph([road([-100, 0, -1.5, 0]), road([0, 1.2, 0, 100]), road([-100, 0, -100, 100]), road([-100, 100, 0, 100])]);
    expect(reachable(g, 0).size).toBe(g.nodeX.length);
  });

  it('merges near-identical vertices from neighbouring tiles', () => {
    // the halves of a road cut at a tile edge meet at one shared node
    const g = buildRoadGraph([road([-100, 0, 0, 0]), road([0.4, 0.3, 100, 0])]);
    expect(g.nodeX.length).toBe(3);
    expect(g.links.length).toBe(2);
    expect(reachable(g, 0).size).toBe(3);
  });
});
