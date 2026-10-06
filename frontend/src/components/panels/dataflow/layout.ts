/**
 * A layered layout for a product's dataflow (a small DAG): each node in the
 * row after its deepest input, rows top to bottom, nodes in a row ordered to
 * sit near their inputs. Pure, so it is tested on its own.
 */

export interface GNode {
  id: string;
}

export interface GEdge {
  source: string;
  target: string;
}

export interface Placed {
  id: string;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
}

export function layers(nodes: GNode[], edges: GEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const inputs = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    inputs.set(e.target, [...(inputs.get(e.target) ?? []), e.source]);
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const of = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // a cycle (should not happen): break it
    visiting.add(id);
    const d = Math.max(-1, ...(inputs.get(id) ?? []).map(of)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => of(n.id));
  return depth;
}

export function place(
  nodes: GNode[],
  edges: GEdge[],
  width: number,
  opts: { nodeH?: number; gapY?: number; gapX?: number; maxW?: number; pad?: number } = {},
): { placed: Placed[]; height: number } {
  const nodeH = opts.nodeH ?? 46;
  const gapY = opts.gapY ?? 26;
  const gapX = opts.gapX ?? 8;
  const maxW = opts.maxW ?? 230;
  const pad = opts.pad ?? 10;
  const depth = layers(nodes, edges);
  const rows: string[][] = [];
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    (rows[d] ??= []).push(n.id);
  }
  // Order each row by the mean position of its inputs in the row above.
  const position = new Map<string, number>();
  rows.forEach((row, r) => {
    if (r > 0) {
      const mean = (id: string) => {
        const xs = edges.filter((e) => e.target === id && position.has(e.source)).map((e) => position.get(e.source)!);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Infinity;
      };
      row.sort((a, b) => mean(a) - mean(b));
    }
    row.forEach((id, i) => position.set(id, i / Math.max(1, row.length - 1)));
  });
  const placed: Placed[] = [];
  rows.forEach((row, r) => {
    const n = row.length;
    const w = Math.min(maxW, (width - 2 * pad - gapX * (n - 1)) / Math.max(1, n));
    const total = n * w + (n - 1) * gapX;
    const x0 = (width - total) / 2;
    row.forEach((id, i) => {
      placed.push({ id, row: r, col: i, x: x0 + i * (w + gapX), y: pad + r * (nodeH + gapY), w });
    });
  });
  return { placed, height: pad * 2 + rows.length * nodeH + Math.max(0, rows.length - 1) * gapY };
}
