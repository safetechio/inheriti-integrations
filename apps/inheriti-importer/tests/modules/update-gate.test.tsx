import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UpdateGate } from '../../src/modules/_shared/ui/components/UpdateStatus';

afterEach(cleanup);

it('keeps importer content unmounted while update is required and after installation failure', async () => {
  const updates = {
    check: vi.fn(async () => ({ version: '0.1.1', update: { id: 'build-1', version: '0.1.2' } })),
    install: vi.fn(async () => {
      throw new Error('download failed');
    }),
    reopen: vi.fn(),
  };
  render(
    <UpdateGate updates={updates}>
      <button>Importer content</button>
    </UpdateGate>,
  );
  expect(screen.queryByRole('button', { name: 'Importer content' })).toBeNull();
  const install = await screen.findByRole('button', { name: 'Install and relaunch' });
  fireEvent.click(install);
  await screen.findByRole('button', { name: 'Retry update' });
  expect(screen.queryByRole('button', { name: 'Importer content' })).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Importer content' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry update' }));
  await waitFor(() => expect(updates.install).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: 'Importer content' })).toBeNull();
});

it('mounts importer content only after a successful no-update check', async () => {
  const updates = {
    check: vi.fn(async () => ({ version: '0.1.1', update: null })),
    install: vi.fn(),
    reopen: vi.fn(),
  };
  render(
    <UpdateGate updates={updates}>
      <button>Importer content</button>
    </UpdateGate>,
  );
  expect(await screen.findByRole('button', { name: 'Importer content' })).toBeTruthy();
});

it('ignores a stale check when the update bridge changes', async () => {
  let resolveOld!: (result: {
    version: string;
    update: { id: string; version: string } | null;
  }) => void;
  const oldUpdates = {
    check: vi.fn(
      () =>
        new Promise<{ version: string; update: { id: string; version: string } }>((resolve) => {
          resolveOld = resolve;
        }),
    ),
    install: vi.fn(),
    reopen: vi.fn(),
  };
  const currentUpdates = {
    check: vi.fn(async () => ({ version: '0.1.3', update: null })),
    install: vi.fn(),
    reopen: vi.fn(),
  };
  const { rerender } = render(
    <UpdateGate updates={oldUpdates}>
      <button>Importer content</button>
    </UpdateGate>,
  );
  await waitFor(() => expect(oldUpdates.check).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: 'Importer content' })).toBeNull();

  rerender(
    <UpdateGate updates={currentUpdates}>
      <button>Importer content</button>
    </UpdateGate>,
  );
  expect(await screen.findByRole('button', { name: 'Importer content' })).toBeTruthy();

  resolveOld({ version: '0.1.1', update: { id: 'old-build', version: '0.1.2' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Importer content' })).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: 'Install and relaunch' })).toBeNull();
  expect(currentUpdates.check).toHaveBeenCalledTimes(1);
});

it('reopens after installer handoff and retries a failed reopen without reinstalling', async () => {
  const updates = {
    check: vi.fn(async () => ({ version: '0.1.1', update: { id: 'build-1', version: '0.1.2' } })),
    install: vi.fn(async () => ({ installed: false, openedInstaller: true })),
    reopen: vi
      .fn()
      .mockRejectedValueOnce(new Error('relaunch failed'))
      .mockResolvedValueOnce({ relaunching: true }),
  };
  render(
    <UpdateGate updates={updates}>
      <button>Importer content</button>
    </UpdateGate>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Install and relaunch' }));
  const reopen = await screen.findByRole('button', { name: 'Reopen Importer' });
  expect(screen.queryByRole('button', { name: 'Importer content' })).toBeNull();
  fireEvent.click(reopen);
  await screen.findByText(/Could not reopen Importer/);
  fireEvent.click(screen.getByRole('button', { name: 'Reopen Importer' }));
  await waitFor(() => expect(updates.reopen).toHaveBeenCalledTimes(2));
  expect(updates.install).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Could not reopen Importer/)).toBeNull();
});
