import type { Edge, Node } from '@pondpilot/flowscope-core';
import { GRAPH_CONFIG } from '../constants';
import { buildColumnOwnershipMap, resolveOutputMapping } from './lineageHelpers';

/**
 * Shared column-lineage filtering primitives used by both the main-thread
 * graph builder and the worker. Kept in its own module (no React Flow / DOM
 * dependencies) so the worker bundle does not pull in `@xyflow/react` or other
 * main-thread-only code.
 *
 * Behavior MUST stay identical on both paths — they are hot-swapped behind a
 * feature flag that chooses between worker and inline builds.
 */

/**
 * Minimum column count at which column-lineage mode prunes columns that have
 * no visible lineage. Narrow tables keep every column (preserving the user's
 * mental model of the schema); wide tables get pruned because the extra rows
 * add noise without adding information.
 */
export const COLUMN_LINEAGE_FILTER_THRESHOLD = 50;

interface GraphLike {
  edges: Edge[];
  isSelect: boolean;
}

export interface ColumnLineageFilterOptions {
  showColumnEdges: boolean;
  selectedColumnId?: string | null;
  searchTerm?: string;
}

/**
 * Collect column ids that are endpoints of column-level lineage edges that can
 * actually be rendered in the current graph state.
 *
 * The rendered graph only keeps a column edge when both endpoints are columns,
 * they belong to different relations, and neither owning relation is currently
 * collapsed. If an edge degrades to a table-level fallback, its columns should
 * still be treated as hidden for pruning purposes because there is no visible
 * handle-to-handle connection left in the graph.
 */
export function buildConnectedColumnIdSet(
  merged: GraphLike,
  tableNodes: Node[],
  outputNodes: Node[],
  columnNodes: Node[],
  isRelationCollapsed: (relationId: string) => boolean
): Set<string> {
  const columnIds = new Set(columnNodes.map((node) => node.id));
  const connectedColumnIds = new Set<string>();
  const columnToRelationMap = buildColumnOwnershipMap(merged.edges, tableNodes, (node) => node.id);

  resolveOutputMapping(
    merged.edges,
    outputNodes,
    columnNodes,
    columnToRelationMap,
    merged.isSelect,
    GRAPH_CONFIG.VIRTUAL_OUTPUT_NODE_ID
  );

  for (const edge of merged.edges) {
    if (edge.type !== 'data_flow' && edge.type !== 'derivation') {
      continue;
    }

    if (!columnIds.has(edge.from) || !columnIds.has(edge.to)) {
      continue;
    }

    const sourceRelationId = columnToRelationMap.get(edge.from);
    const targetRelationId = columnToRelationMap.get(edge.to);

    if (!sourceRelationId || !targetRelationId || sourceRelationId === targetRelationId) {
      continue;
    }

    if (isRelationCollapsed(sourceRelationId) || isRelationCollapsed(targetRelationId)) {
      continue;
    }

    connectedColumnIds.add(edge.from);
    connectedColumnIds.add(edge.to);
  }

  return connectedColumnIds;
}

/**
 * In column-lineage mode, drop columns with no visible lineage from tables
 * that exceed `COLUMN_LINEAGE_FILTER_THRESHOLD`. Returns the (possibly
 * filtered) columns and the count of columns that were hidden, so the UI can
 * surface a "+N hidden" affordance.
 *
 * The active column selection and any search-matching columns are preserved so
 * downstream highlighting/focus paths still have a visible anchor even when
 * the rest of the wide table is pruned.
 */
export function filterColumnsForColumnLineage<T extends { id: string; name: string }>(
  columns: T[],
  connectedColumnIds: ReadonlySet<string>,
  options: ColumnLineageFilterOptions
): { columns: T[]; lineageHiddenColumnCount: number } {
  if (!options.showColumnEdges || columns.length <= COLUMN_LINEAGE_FILTER_THRESHOLD) {
    return { columns, lineageHiddenColumnCount: 0 };
  }

  const normalizedSearchTerm = options.searchTerm?.trim().toLowerCase();
  const visibleColumns = columns.filter((column) => {
    if (connectedColumnIds.has(column.id)) {
      return true;
    }

    if (options.selectedColumnId === column.id) {
      return true;
    }

    return !!normalizedSearchTerm && column.name.toLowerCase().includes(normalizedSearchTerm);
  });
  const lineageHiddenColumnCount = columns.length - visibleColumns.length;

  if (lineageHiddenColumnCount === 0) {
    return { columns, lineageHiddenColumnCount: 0 };
  }

  return { columns: visibleColumns, lineageHiddenColumnCount };
}

/** Shared empty set so callers can avoid allocating on the cold path. */
export const EMPTY_CONNECTED_COLUMN_IDS: ReadonlySet<string> = new Set();
