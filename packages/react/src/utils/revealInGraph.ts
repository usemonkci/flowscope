import type { AnalyzeResult, Node, Span, StatementMeta } from '@pondpilot/flowscope-core';

import { findMergedNodeById, resolveNodeSourceName } from './nodeOccurrences';

/**
 * Kind of span an index entry refers to.
 *
 * - `'name'` — a `nameSpan` (the identifier occurrence for a table/CTE/column).
 * - `'body'` — a `bodySpan` (the parenthesised body of a CTE definition).
 *
 * Name matches take precedence over body matches at lookup time: placing the
 * cursor on a CTE name inside its own definition should focus that CTE node,
 * not the enclosing one.
 */
export type SpanIndexEntryKind = 'name' | 'body';

/**
 * A single entry in the reveal-in-graph span index.
 *
 * One node may contribute multiple entries (e.g. a CTE referenced several
 * times yields one entry per `nameSpan`, plus one entry per `bodySpan`).
 */
export interface SpanIndexEntry {
  /** ID of the lineage node this span belongs to. */
  nodeId: string;
  /** Byte-offset span (analyzer coordinates). */
  span: Span;
  /** Whether this span is a name occurrence or a CTE body. */
  kind: SpanIndexEntryKind;
  /** Width of the span (end - start). Precomputed for tie-breaking. */
  size: number;
}

export interface SpanIndex {
  entries: SpanIndexEntry[];
}

const EMPTY_INDEX: SpanIndex = { entries: [] };

function pushEntries(
  target: SpanIndexEntry[],
  nodeId: string,
  spans: Span[] | undefined,
  kind: SpanIndexEntryKind
): void {
  if (!spans || spans.length === 0) return;
  for (const span of spans) {
    if (!span) continue;
    const size = span.end - span.start;
    if (size <= 0) continue;
    target.push({ nodeId, span, kind, size });
  }
}

/**
 * Build an interval index of every known `nameSpan` and `bodySpan` across the
 * flat node list. Called once per analysis result; the result is cheap to hold
 * in memo state.
 *
 * Nodes are merged via `findMergedNodeById` so shared nodes (referenced across
 * multiple statements) contribute every occurrence exactly once.
 */
export function buildSpanIndex(result: AnalyzeResult | null): SpanIndex {
  if (!result || !result.nodes || result.nodes.length === 0) {
    return EMPTY_INDEX;
  }

  // Walk the flat node list, but dedupe by id — `findMergedNodeById` will
  // rebuild the full per-id occurrence list, so we only need to visit each
  // unique node once.
  const seen = new Set<string>();
  const entries: SpanIndexEntry[] = [];
  const statementById = new Map<number, Pick<StatementMeta, 'sourceName'>>(
    result.statements.map((s) => [s.statementIndex, s])
  );

  for (const rawNode of result.nodes) {
    if (seen.has(rawNode.id)) continue;
    seen.add(rawNode.id);

    const merged = findMergedNodeById(result, rawNode.id);
    const node: Node | null = merged ?? rawNode;
    if (!node) continue;
    // `resolveNodeSourceName` is imported so callers/consumers can extend the
    // entry shape later without another pass over the graph. Currently unused
    // but kept referenced to document the relationship with occurrence data.
    void resolveNodeSourceName(node, statementById);

    pushEntries(entries, node.id, node.nameSpans, 'name');
    if (node.bodySpan) {
      pushEntries(entries, node.id, [node.bodySpan], 'body');
    }
  }

  return { entries };
}

/**
 * Look up the node whose span best contains `byteOffset`.
 *
 * Returns `null` when the cursor is in whitespace or otherwise outside every
 * indexed span. Spans are treated as half-open `[start, end)`. Name matches
 * beat body matches; within a kind, the smallest containing span wins.
 */
export function findNodeAtByteOffset(index: SpanIndex, byteOffset: number): SpanIndexEntry | null {
  let bestName: SpanIndexEntry | null = null;
  let bestBody: SpanIndexEntry | null = null;

  for (const entry of index.entries) {
    if (byteOffset < entry.span.start || byteOffset >= entry.span.end) continue;
    if (entry.kind === 'name') {
      if (!bestName || entry.size < bestName.size) bestName = entry;
    } else if (!bestBody || entry.size < bestBody.size) {
      bestBody = entry;
    }
  }

  return bestName ?? bestBody;
}
