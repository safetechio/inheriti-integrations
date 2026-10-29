import { expect, it, vi } from 'vitest';

const { io, connect, disconnect, on, removeAllListeners } = vi.hoisted(() => ({
  io: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), on: vi.fn(), removeAllListeners: vi.fn(),
}));

vi.mock('socket.io-client', () => ({ io }));

import { createNodeInboxEventListener } from '../src/node.js';

it('reauthenticates an expired inbox socket and stops after explicit close', async () => {
  io.mockReturnValue({ connect, disconnect, on, removeAllListeners, emit: vi.fn() });
  const getBearerToken = vi.fn().mockResolvedValueOnce('expired-token').mockResolvedValueOnce('fresh-token');
  const onPresence = vi.fn();
  const stop = createNodeInboxEventListener('https://api.example.test/path', getBearerToken, vi.fn(), vi.fn(), 'tenant-1', onPresence);
  const authentication = io.mock.calls[0]?.[1].auth;
  await new Promise<void>((resolve) => authentication(() => resolve()));
  const disconnected = on.mock.calls.filter(([event]) => event === 'disconnect').map(([, handler]) => handler);
  for (const handler of disconnected) handler('io server disconnect');
  expect(onPresence).toHaveBeenCalledWith(null);
  await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
  stop();
  for (const handler of disconnected) handler('io server disconnect');
  await Promise.resolve();
  expect(connect).toHaveBeenCalledTimes(2);
  expect(removeAllListeners).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
});
