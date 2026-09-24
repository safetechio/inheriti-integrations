import { expect, it, vi } from 'vitest';

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
