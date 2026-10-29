import { expect, it, vi } from 'vitest';

const { io, destroy, disconnect, connect, on } = vi.hoisted(() => ({
  io: vi.fn(), destroy: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), on: vi.fn(),
}));

vi.mock('socket.io-client', () => ({ io }));
vi.mock('@safetech/inheriti-core-sdk/shared-configuration/vanilla', () => ({
  SocketIoSharedPlanEventListener: class { destroy = destroy; },
}));

import { createNodePlanEventListener } from '../src/node.js';

it('authenticates the socket with the current token and closes its listener', async () => {
  io.mockReturnValue({ disconnect, connect, on });
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

it('reconnects a server-disconnected plan socket only after a new token is available', async () => {
  io.mockClear();
  on.mockClear();
  connect.mockClear();
  const getBearerToken = vi.fn().mockResolvedValueOnce('expired-token').mockResolvedValueOnce('fresh-token');
  io.mockReturnValue({ disconnect, connect, on });
  const connection = createNodePlanEventListener('https://api.example.test/path', getBearerToken);
  const authentication = io.mock.calls[0]?.[1].auth;
  await new Promise<void>((resolve) => authentication(() => resolve()));
  const disconnected = on.mock.calls.find(([event]) => event === 'disconnect')?.[1];
  disconnected('io server disconnect');
  await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
  connection.close();
});

it('does not reconnect a plan socket when a server disconnect leaves its token unchanged', async () => {
  io.mockClear();
  on.mockClear();
  connect.mockClear();
  const getBearerToken = vi.fn().mockResolvedValue('same-token');
  io.mockReturnValue({ disconnect, connect, on });
  const connection = createNodePlanEventListener('https://api.example.test/path', getBearerToken);
  await new Promise<void>((resolve) => io.mock.calls[0]?.[1].auth(() => resolve()));
  const disconnected = on.mock.calls.find(([event]) => event === 'disconnect')?.[1];
  disconnected('io server disconnect');
  await vi.waitFor(() => expect(getBearerToken).toHaveBeenCalledTimes(2));
  expect(connect).not.toHaveBeenCalled();
  connection.close();
});

it('does not reconnect a closed plan socket after token refresh completes', async () => {
  io.mockClear();
  on.mockClear();
  connect.mockClear();
  let resolveRefresh!: (token: string) => void;
  const getBearerToken = vi.fn().mockResolvedValueOnce('same-token').mockImplementationOnce(() => new Promise<string>((resolve) => { resolveRefresh = resolve; }));
  io.mockReturnValue({ disconnect, connect, on });
  const connection = createNodePlanEventListener('https://api.example.test/path', getBearerToken);
  await new Promise<void>((resolve) => io.mock.calls[0]?.[1].auth(() => resolve()));
  const disconnected = on.mock.calls.find(([event]) => event === 'disconnect')?.[1];
  disconnected('io server disconnect');
  await vi.waitFor(() => expect(getBearerToken).toHaveBeenCalledTimes(2));
  connection.close();
  resolveRefresh('different-token');
  await Promise.resolve();
  expect(connect).not.toHaveBeenCalled();
});
