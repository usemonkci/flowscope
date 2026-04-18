import * as vscode from 'vscode';
import { completionItems, isWasmInitialized } from '../analysis';
import type { CompletionItem as FlowscopeCompletionItem, Dialect } from '../types';

/**
 * Provides SQL IntelliSense backed by the flowscope completion engine:
 * dialect keywords, built-in functions, operators, and any table / view /
 * CTE / column names recovered from the current parse.
 */
export class FlowScopeCompletionProvider implements vscode.CompletionItemProvider {
  /** Completions fire on every typed character, plus `.` for qualified refs. */
  public static readonly triggerCharacters: readonly string[] = ['.'];

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionList> {
    const config = vscode.workspace.getConfiguration('flowscope');
    if (!config.get<boolean>('enableCompletion', true)) {
      return null;
    }

    if (!isWasmInitialized()) {
      return null;
    }

    const sql = document.getText();
    const dialect = config.get<Dialect>('dialect', 'generic');
    // `document.offsetAt` yields a UTF-16 code-unit offset, which matches
    // `encoding: 'utf16'` on the engine request — no byte conversion needed.
    const cursorOffset = document.offsetAt(position);

    let result;
    try {
      result = completionItems({ sql, dialect, cursorOffset, encoding: 'utf16' });
    } catch (error) {
      console.warn('FlowScope completion failed:', error);
      return null;
    }

    if (!result.shouldShow || result.items.length === 0) {
      return null;
    }

    const replaceRange = result.token
      ? new vscode.Range(
          document.positionAt(result.token.span.start),
          document.positionAt(result.token.span.end)
        )
      : undefined;

    return new vscode.CompletionList(
      result.items.map((item) => toVsCodeCompletionItem(item, replaceRange)),
      /* isIncomplete */ false
    );
  }
}

const VSCODE_KIND_BY_FLOWSCOPE_KIND: Record<
  FlowscopeCompletionItem['kind'],
  vscode.CompletionItemKind
> = {
  keyword: vscode.CompletionItemKind.Keyword,
  operator: vscode.CompletionItemKind.Operator,
  function: vscode.CompletionItemKind.Function,
  snippet: vscode.CompletionItemKind.Snippet,
  table: vscode.CompletionItemKind.Struct,
  schemaTable: vscode.CompletionItemKind.Module,
  column: vscode.CompletionItemKind.Field,
};

const FALLBACK_DETAIL: Record<FlowscopeCompletionItem['kind'], string> = {
  keyword: 'keyword',
  operator: 'operator',
  function: 'function',
  snippet: 'snippet',
  table: 'table',
  schemaTable: 'schema table',
  column: 'column',
};

/**
 * VS Code sorts completions by `sortText` ascending. The flowscope engine
 * returns higher scores for better matches, so we invert the score to keep
 * the order the user expects.
 */
const MAX_SORT_BUCKET = 9999;

function toVsCodeCompletionItem(
  item: FlowscopeCompletionItem,
  replaceRange: vscode.Range | undefined
): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(
    item.label,
    VSCODE_KIND_BY_FLOWSCOPE_KIND[item.kind]
  );
  completion.detail = item.detail ?? FALLBACK_DETAIL[item.kind];
  if (item.insertText !== item.label) {
    completion.insertText = item.insertText;
  }
  if (replaceRange) {
    completion.range = replaceRange;
  }
  const bucket = Math.max(0, Math.min(MAX_SORT_BUCKET, Math.floor(MAX_SORT_BUCKET - item.score)));
  completion.sortText = bucket.toString().padStart(5, '0') + item.label.toLowerCase();
  return completion;
}
