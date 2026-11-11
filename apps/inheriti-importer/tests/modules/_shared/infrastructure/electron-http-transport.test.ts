// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiStatusError } from '@modules/_shared/domain/api-status-error';

vi.mock('@modules/organization/infrastructure/selected-organization-api', () => ({
  getSelectedOrganizationSnapshot: () => 'org-a',
}));

import { ElectronHttpTransport } from '@modules/_shared/infrastructure/transport/electron-http-transport';

afterEach(() => {
  Object.assign(window, { inheriti: undefined });
});

describe('ElectronHttpTransport', () => {
  it.each([401, 403, 404, 500])('retains HTTP %i on API errors', async (status) => {
    Object.assign(window, {
      inheriti: {
        api: { request: vi.fn().mockResolvedValue({ status, body: { message: 'denied' } }) },
      },
    });
    await expect(
      new ElectronHttpTransport().request({ method: 'GET', path: '/test' }),
    ).rejects.toMatchObject({
      name: 'ApiStatusError',
      status,
      message: 'denied',
    } satisfies Partial<ApiStatusError>);
  });
});
