import { expect, it, vi } from 'vitest';
import { shell } from 'electron';

const mock = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(), notify: vi.fn() }));

vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => mock.handlers.set(name, handler) },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../src/modules/quick-plan/main/quick-plan-input.js', () => ({ parseQuickPlanInput: (input: unknown) => input }));

import { registerTrayIpc } from '../src/modules/launcher/main/ipc.js';

it('notifies only after confirmed protection or update using generic text', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  let creationStatus = 'error';
  let editStatus = 'recovery-required';
  const session = {
    state: () => ({ creation: { status: creationStatus }, edit: { status: editStatus } }),
    createQuickPlan: vi.fn(), addPlanAsset: vi.fn(), replacePlanAsset: vi.fn(), recoverPlanEdit: vi.fn(),
  };
  registerTrayIpc(session as never, () => ({ webContents }) as never, vi.fn(), undefined, mock.notify);
  const create = mock.handlers.get('tray:create-quick-plan')!;
  const add = mock.handlers.get('tray:add-plan-asset')!;
  const replace = mock.handlers.get('tray:replace-plan-asset')!;
  const recover = mock.handlers.get('tray:recover-plan-edit')!;
  await create(event, { title: 'Private', asset: { secret: 'do not notify' } });
  await add(event, 'plan-1', { secret: 'do not notify' });
  await replace(event, 'plan-1', 'asset-1', { secret: 'do not notify' });
  await recover(event);
  expect(mock.notify).not.toHaveBeenCalled();
  creationStatus = 'ready';
  editStatus = 'updated';
  await create(event, { title: 'Private', asset: { secret: 'do not notify' } });
  await add(event, 'plan-1', { secret: 'do not notify' });
  await replace(event, 'plan-1', 'asset-1', { secret: 'do not notify' });
  await recover(event);
  expect(mock.notify.mock.calls).toEqual([
    ['Plan protected'], ['Plan updated'], ['Plan updated'], ['Plan updated'],
  ]);
});

it('opens the completed backup plan in Business', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const session = { state: () => ({ creation: { status: 'ready', planId: 'plan-1' } }) };
  registerTrayIpc(session as never, () => ({ webContents }) as never, vi.fn(), 'https://business.example/');
  const open = mock.handlers.get('tray:open-app')!;
  await open(event, 'plan-1');
  expect(shell.openExternal).toHaveBeenCalledWith('https://business.example/organization/plans/backup/plan-1');
  expect(() => open(event, 'another-plan')).toThrow('Plan is no longer available.');
});

it('opens an updated backup plan in Business', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const session = { state: () => ({ edit: { status: 'updated', planId: 'edited-plan' } }) };
  registerTrayIpc(session as never, () => ({ webContents }) as never, vi.fn(), 'https://business.example/');
  await mock.handlers.get('tray:open-app')!(event, 'edited-plan');
  expect(shell.openExternal).toHaveBeenCalledWith('https://business.example/organization/plans/backup/edited-plan');
});
