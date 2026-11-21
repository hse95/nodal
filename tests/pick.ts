import type { Expected } from '../src/examples';
import type { DataTree } from '../src/core/tree';

/** Read the value an example or template states as its expected result from a component output. */
export function pickValue(t: DataTree | undefined, e: Expected): number {
  const items = (t?.allItems() ?? []).map((x: any) => (e.comp ? x?.[e.comp] : typeof x === 'boolean' ? Number(x) : x)) as number[];
  switch (e.pick) {
    case 'count': return items.length;
    case 'max': return Math.max(...items);
    case 'min': return Math.min(...items);
    case 'absmax': return Math.max(...items.map(Math.abs));
    default: return items[0];
  }
}

