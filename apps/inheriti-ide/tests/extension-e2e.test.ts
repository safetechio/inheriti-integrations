import { describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const commands = new Map<string, (...args: any[]) => Promise<unknown>>();
  const cores = new Map<string, ReturnType<typeof makeCore>>();
  const makeCore = (organizationId?: string) => ({
    organizationId,
    getAccessToken: vi.fn(async () => 'token'),
    listOrganizations: vi.fn(async () => [{ id: 'org-a', name: 'Alpha' }, { id: 'org-b', name: 'Beta' }]),
    listPlans: vi.fn(async (options?: { cursor: string }) => organizationId === 'org-b'
      ? { items: [{ id: 'beta-plan', name: 'Beta Plan', status: 'ACTIVE' }], nextCursor: null }
      : options?.cursor
        ? { items: [{ id: 'alpha-2', name: 'Second Plan', status: 'ACTIVE' }], nextCursor: null }
        : { items: [{ id: 'alpha-1', name: 'First Plan', status: 'ACTIVE' }], nextCursor: 'next' }),
    getPlan: vi.fn(async (id: string) => ({ id, name: id, assets: [{ id: 'asset-1', code: 'login', name: 'Login', fieldNames: ['password'] }] })),
    withReveal: vi.fn(async (_id: string, _options: unknown, work: (reveal: unknown) => Promise<unknown>) => work({
      session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
      field: vi.fn(async () => 'protected-value'),
    })),
    forgetMasterKey: vi.fn(async () => undefined),
  });
  return { commands, cores, makeCore, quickPick: vi.fn(), information: vi.fn(async () => undefined), error: vi.fn(async () => undefined), shown: vi.fn(), tree: undefined as unknown, provider: undefined as unknown };
});

vi.mock('../src/elements.js', () => ({
  createExtensionCore: (_settings: unknown, _sessions: unknown, _secrets: unknown, organizationId?: string) => {
    const key = organizationId ?? 'unscoped';
    if (!fixture.cores.has(key)) fixture.cores.set(key, fixture.makeCore(organizationId));
    return fixture.cores.get(key);
  },
}));

vi.mock('vscode', () => {
  class EventEmitter<T> {
    event = (_listener: (value: T) => void) => ({ dispose() {} });
    fire(_value: T) {}
    dispose() {}
  }
  class TreeItem {
    description?: string;
    contextValue?: string;
    command?: unknown;
    iconPath?: unknown;
    constructor(public label: string, public collapsibleState: number) {}
  }
  class CancellationTokenSource {
    token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    cancel() { this.token.isCancellationRequested = true; }
    dispose() {}
  }
  const uri = (scheme: string, path: string) => ({ scheme, path, fsPath: path });
  return {
    EventEmitter, TreeItem, CancellationTokenSource,
    TreeItemCollapsibleState: { None: 0 }, ProgressLocation: { Notification: 1 },
    Uri: { parse: (value: string) => { const offset = value.indexOf(':'); return uri(value.slice(0, offset), value.slice(offset + 1)); }, joinPath: (_root: unknown, name: string) => uri('file', name) },
    commands: {
      registerCommand: (name: string, handler: (...args: any[]) => Promise<unknown>) => { fixture.commands.set(name, handler); return { dispose() {} }; },
      executeCommand: vi.fn(async () => undefined),
    },
    workspace: {
      getConfiguration: () => ({ get: (key: string) => ({ apiUrl: 'https://api.example.test', issuer: 'https://issuer.example.test', clientId: 'ide-client', environment: 'TEST' })[key] }),
      textDocuments: [],
      fs: { createDirectory: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined) },
      onDidChangeConfiguration: () => ({ dispose() {} }),
      registerTextDocumentContentProvider: (_scheme: string, provider: unknown) => { fixture.provider = provider; return { dispose() {} }; },
      openTextDocument: vi.fn(async (documentUri: unknown) => documentUri),
    },
    window: {
      registerTreeDataProvider: (_id: string, provider: unknown) => { fixture.tree = provider; return { dispose() {} }; },
      registerUriHandler: () => ({ dispose() {} }),
      showQuickPick: fixture.quickPick,
      showInformationMessage: fixture.information,
      showErrorMessage: fixture.error,
      showTextDocument: fixture.shown,
      setStatusBarMessage: vi.fn(),
      withProgress: async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
      activeTextEditor: undefined as unknown,
    },
  };
});

import * as vscode from 'vscode';
import { activate } from '../src/extension.js';

describe('IDE extension host workflow', () => {
  it('selects and switches Business organizations, opens a plan, and inserts a revealed field', async () => {
    const stored = new Map<string, string>();
    const state = new Map<string, unknown>();
    stored.set('inheriti.operatorSession', JSON.stringify({ principal: { subject: 'operator-1' } }));
    const context = {
      subscriptions: [], globalStorageUri: vscode.Uri.parse('file:/avatars'),
      secrets: { get: async (key: string) => stored.get(key), store: async (key: string, value: string) => { stored.set(key, value); }, delete: async (key: string) => { stored.delete(key); } },
      globalState: { get: (key: string, fallback: unknown) => state.get(key) ?? fallback, update: async (key: string, value: unknown) => { state.set(key, value); } },
      extension: { packageJSON: { version: '0.0.9' } },
    } as unknown as vscode.ExtensionContext;
    const api = activate(context);
    await api.refresh();
    expect(api.currentRows()[0]?.label).toBe('Choose a Business organization');

    fixture.quickPick.mockImplementationOnce(async (items: Array<{ id: string }>) => items[0]);
    await fixture.commands.get('inheriti.selectOrganization')?.();
    expect(api.currentRows().map((row) => row.label)).toEqual(['Organization: Alpha', 'First Plan', 'Second Plan']);
    expect(fixture.cores.get('org-a')?.listPlans).toHaveBeenCalledWith({ cursor: 'next' });
    const items = await (fixture.tree as { getChildren(): Promise<Array<{ command?: { arguments: string[] } }>> }).getChildren();
    expect(items[1]?.command?.arguments).toEqual(['alpha-1']);

    await fixture.commands.get('inheriti.openPlan')?.('alpha-1');
    const opened = vi.mocked(vscode.workspace.openTextDocument).mock.calls.at(-1)?.[0];
    expect(opened).toMatchObject({ scheme: 'inheriti-plan', path: '/alpha-1.json' });
    expect(await (fixture.provider as { provideTextDocumentContent(uri: vscode.Uri): Promise<string> }).provideTextDocumentContent(opened as vscode.Uri))
      .toContain('"id": "alpha-1"');
    expect(fixture.cores.get('org-a')?.getPlan).toHaveBeenCalledWith('alpha-1');

    const selection = { isEqual: (other: unknown) => other === selection };
    const replace = vi.fn();
    const editor = { selection, document: { version: 1, isClosed: false }, edit: vi.fn(async (apply: (edit: { replace: (selection: unknown, value: string) => void }) => void) => {
      apply({ replace });
      return true;
    }) };
    vscode.window.activeTextEditor = editor as never;
    fixture.quickPick.mockImplementationOnce(async (items: Array<{ selector: string }>) => items[0]);
    await fixture.commands.get('inheriti.revealPlan')?.('alpha-1');
    expect(fixture.cores.get('org-a')?.withReveal).toHaveBeenCalledOnce();
    expect(editor.edit).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledExactlyOnceWith(selection, 'protected-value');
    expect(fixture.error).not.toHaveBeenCalled();

    await fixture.commands.get('inheriti.forgetOrgKey')?.();
    expect(fixture.cores.get('org-a')?.forgetMasterKey).toHaveBeenCalledOnce();
    fixture.quickPick.mockImplementationOnce(async (choices: Array<{ id: string }>) => choices[1]);
    await fixture.commands.get('inheriti.selectOrganization')?.();
    expect(api.currentRows().map((row) => row.label)).toEqual(['Organization: Beta', 'Beta Plan']);
    expect(fixture.cores.get('org-a')?.forgetMasterKey).toHaveBeenCalledTimes(2);
    expect(fixture.cores.get('org-b')?.listPlans).toHaveBeenCalled();
  });
});
