import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

it('delivers a cold-window action to every mounted subscriber', async () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  let exposed!: { onAction: (callback: (action: string) => void) => () => void };
  const electron = {
    contextBridge: { exposeInMainWorld: (_name: string, api: typeof exposed) => { exposed = api; } },
    ipcRenderer: { on: (name: string, listener: (...args: unknown[]) => void) => { listeners.set(name, listener); } },
  };
  const source = readFileSync(new URL('../src/preload.cts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(compiled, { require: () => electron, queueMicrotask, exports: {} });
  listeners.get('tray:action')?.({}, 'Create plan');
  const first = vi.fn();
  const second = vi.fn();
  exposed.onAction(first);
  exposed.onAction(second);
  await Promise.resolve();
  expect(first).toHaveBeenCalledWith('Create plan');
  expect(second).toHaveBeenCalledWith('Create plan');
});
