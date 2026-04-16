import { describe, it, expect, beforeEach } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import type { AnalyzeResult } from '@pondpilot/flowscope-core';

import { createLineageStore, type LineageState } from '../src/store';

describe('revealNodeInGraph', () => {
  let store: StoreApi<LineageState>;

  beforeEach(() => {
    store = createLineageStore();
  });

  const buildResult = (): AnalyzeResult =>
    ({
      statements: [{ statementIndex: 0, sourceName: 'query.sql' }],
      nodes: [],
      edges: [],
      issues: [],
    }) as unknown as AnalyzeResult;

  it('selects the node and records a reveal request', () => {
    store.getState().revealNodeInGraph('table:users');

    const state = store.getState();
    expect(state.selectedNodeId).toBe('table:users');
    expect(state.highlightedSpan).toBeNull();
    expect(state.focusedOccurrenceIndex).toBe(0);
    expect(state.revealRequest).toEqual({
      nodeId: 'table:users',
      nonce: 1,
      suppressNavigation: true,
    });
  });

  it('bumps the nonce when the same node is revealed repeatedly', () => {
    store.getState().revealNodeInGraph('cte:active');
    store.getState().revealNodeInGraph('cte:active');
    store.getState().revealNodeInGraph('cte:active');

    expect(store.getState().revealRequest).toEqual({
      nodeId: 'cte:active',
      nonce: 3,
      suppressNavigation: true,
    });
  });

  it('clearRevealRequest drops the pending request without touching selection', () => {
    store.getState().revealNodeInGraph('cte:active');
    store.getState().clearRevealRequest();

    const state = store.getState();
    expect(state.revealRequest).toBeNull();
    expect(state.selectedNodeId).toBe('cte:active');
  });

  it('clears pending reveal requests when a new analysis result is loaded', () => {
    store.getState().revealNodeInGraph('table:users');
    store.getState().setResult(buildResult());

    const state = store.getState();
    expect(state.selectedNodeId).toBeNull();
    expect(state.revealRequest).toBeNull();
  });
});
