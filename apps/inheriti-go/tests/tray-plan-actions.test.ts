import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ buildFromTemplate: vi.fn(), showLauncher: vi.fn() }));

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.20', quit: vi.fn() },
  Menu: { buildFromTemplate: mock.buildFromTemplate },
  Tray: class { setToolTip() {} on() {} setContextMenu() {} },
  nativeImage: {
    createFromPath: () => ({ resize: () => ({ toBitmap: () => Buffer.alloc(22 * 22 * 4) }) }),
    createFromBitmap: () => ({}),
  },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../src/modules/launcher/main/launcher-window.js', () => ({ showLauncher: mock.showLauncher }));

import { registerTrayEvents } from '../src/modules/launcher/main/tray.js';
import { trayMessages } from '../src/messages.js';

beforeEach(() => vi.clearAllMocks());

it.each(['dev', 'prod'])('offers plan actions in the %s tray', (deployment) => {
  registerTrayEvents(undefined, deployment);
  const items = mock.buildFromTemplate.mock.calls[0]![0];
  expect(items[0].label).toBe(`${trayMessages.appName}${deployment === 'prod' ? '' : ' DEV'} · v0.0.20`);
  for (const [label, action] of [
    [trayMessages.createPrivatePlanMenu, trayMessages.savePrivately],
    [trayMessages.createTeamPlanMenu, trayMessages.shareWithTeam],
    [trayMessages.editPlanAssetMenu, trayMessages.addOrEditAsset],
  ]) {
    const item = items.find((candidate: { label?: string }) => candidate.label === label);
    expect(item).toBeDefined();
    item.click();
    expect(mock.showLauncher).toHaveBeenLastCalledWith(action);
  }
});
