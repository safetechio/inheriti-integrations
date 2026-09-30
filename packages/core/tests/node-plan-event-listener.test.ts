import { expect, it, vi } from 'vitest';

const { io, destroy, disconnect } = vi.hoisted(() => ({
  io: vi.fn(), destroy: vi.fn(), disconnect: vi.fn(),
}));

vi.mock('socket.io-client', () => ({ io }));
vi.mock('@safetech/inheriti-core-sdk/shared-configuration/vanilla', () => ({
  SocketIoSharedPlanEventListener: class { destroy = destroy; },
}));

import { createNodePlanEventListener } from '../src/node.js';

it('authenticates the socket with the current token and closes its listener', async () => {
  io.mockReturnValue({ disconnect });
  const getBearerToken = vi.fn().mockResolvedValue('fresh-token');
  const connection = createNodePlanEventListener('https://api.example.test/path', getBearerToken);
  const options = io.mock.calls[0]?.[1];
  expect(io).toHaveBeenCalledWith('https://api.example.test', expect.objectContaining({ autoConnect: false }));
  const authentication = new Promise<object>((resolve) => options.auth(resolve));
  await expect(authentication).resolves.toEqual({ token: 'fresh-token' });
  expect(getBearerToken).toHaveBeenCalledOnce();
  connection.close();
  expect(destroy).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
});
