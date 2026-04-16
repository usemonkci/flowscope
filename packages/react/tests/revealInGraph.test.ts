import { describe, expect, it } from 'vitest';

import type { SpanIndex, SpanIndexEntry } from '../src/utils/revealInGraph';
import { findNodeAtByteOffset } from '../src/utils/revealInGraph';

/**
 * Behavior contract for `findNodeAtByteOffset` — the core lookup for the
 * text→graph reveal action (#24).
 *
 * The rules encoded here are:
 *
 * 1. Cursor in whitespace (no span contains it) → return null.
 * 2. Cursor inside a single `name` span → return that entry.
 * 3. Cursor inside a single `body` span → return that entry.
 * 4. Cursor inside both a `name` and a `body` span → prefer the `name` entry.
 *    (Placing the cursor on a CTE name inside its own definition should focus
 *    that CTE, not the enclosing statement.)
 * 5. Cursor inside two overlapping `body` spans (nested CTEs) → prefer the
 *    smallest containing span — the more specific node wins.
 * 6. Span boundaries are half-open: `[start, end)`. The offset at `span.end`
 *    is *not* contained.
 */

function entry(
  nodeId: string,
  kind: SpanIndexEntry['kind'],
  start: number,
  end: number
): SpanIndexEntry {
  return { nodeId, kind, span: { start, end }, size: end - start };
}

function index(...entries: SpanIndexEntry[]): SpanIndex {
  return { entries };
}

describe('findNodeAtByteOffset', () => {
  it('returns null when the cursor is outside every indexed span', () => {
    const idx = index(entry('a', 'name', 10, 20));
    expect(findNodeAtByteOffset(idx, 5)).toBeNull();
    expect(findNodeAtByteOffset(idx, 25)).toBeNull();
  });

  it('returns null for an empty index', () => {
    expect(findNodeAtByteOffset(index(), 0)).toBeNull();
  });

  it('returns the containing name entry', () => {
    const idx = index(entry('col_x', 'name', 100, 110));
    const hit = findNodeAtByteOffset(idx, 105);
    expect(hit?.nodeId).toBe('col_x');
    expect(hit?.kind).toBe('name');
  });

  it('returns the containing body entry when no name matches', () => {
    const idx = index(entry('cte_a', 'body', 0, 200));
    const hit = findNodeAtByteOffset(idx, 50);
    expect(hit?.nodeId).toBe('cte_a');
    expect(hit?.kind).toBe('body');
  });

  it('prefers a name match over an enclosing body match', () => {
    // Cursor is on a CTE name *inside* the CTE body.
    const idx = index(
      entry('cte_a', 'body', 0, 200),
      entry('cte_a', 'name', 50, 55) // reference to `cte_a` at offset 50..55
    );
    const hit = findNodeAtByteOffset(idx, 52);
    expect(hit?.nodeId).toBe('cte_a');
    expect(hit?.kind).toBe('name');
  });

  it('picks the smallest containing body span when bodies nest', () => {
    // Outer CTE body [0, 200). Inner CTE body [40, 100). Cursor at 50 is in
    // both, but the user meant the inner one.
    const idx = index(entry('outer', 'body', 0, 200), entry('inner', 'body', 40, 100));
    const hit = findNodeAtByteOffset(idx, 50);
    expect(hit?.nodeId).toBe('inner');
  });

  it('treats spans as half-open [start, end)', () => {
    const idx = index(entry('a', 'name', 10, 20));
    expect(findNodeAtByteOffset(idx, 10)?.nodeId).toBe('a');
    // `span.end` is exclusive:
    expect(findNodeAtByteOffset(idx, 20)).toBeNull();
  });
});
