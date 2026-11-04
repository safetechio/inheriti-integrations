import { beforeEach, expect, it, vi } from 'vitest';
import type { Terminal } from '../src/output.js';

const { selectedOrganization, automationManage, automationSetup, githubAutomationCreate, automationStatus } = vi.hoisted(() => ({
  selectedOrganization: vi.fn(async (_context, _configuration, _path, _terminal, id?: string) => ({ id: id ?? 'stored-org' })),
  automationManage: vi.fn(async () => 0), automationSetup: vi.fn(async () => 0), githubAutomationCreate: vi.fn(async () => 0), automationStatus: vi.fn(async () => 0),
}));
vi.mock('../src/configuration.js', async original => ({ ...(await original<object>()), BUILD_DEPLOYMENT: 'dev',
  resolveConfiguration: () => ({ business: true, apiUrl: 'https://business.example/' }) }));
vi.mock('../src/commands/update.js', async original => ({ ...(await original<object>()), requireCliUpdate: async () => 0 }));
vi.mock('../src/organizations.js', async original => ({ ...(await original<object>()), selectedOrganization }));
vi.mock('../src/session.js', async original => ({ ...(await original<object>()), createCliContext: () => ({ core: { getAccessToken: async () => 'token' } }) }));
vi.mock('../src/commands/automations.js', async original => ({ ...(await original<object>()), automationManage }));
vi.mock('../src/commands/automation-setup.js', async original => ({ ...(await original<object>()), automationSetup }));
vi.mock('../src/commands/automation-status.js', async original => ({ ...(await original<object>()), automationStatus }));
vi.mock('../src/commands/github-automation-setup.js', async original => ({ ...(await original<object>()), githubAutomationCreate }));
const terminal: Terminal = { write: () => {}, writeError: () => {}, interactive: false, stdoutIsTTY: false, columns: 80 };

beforeEach(() => vi.clearAllMocks());
it.each([
  ['create', 'github', '--organization', 'org-1'],
  ['setup', 'github', '--organization', 'org-1'],
  ['grant', 'create', '--organization', 'org-1'],
  ['grant', 'activate', '--organization', 'org-1'],
  ['status', '--plan', '00000000-0000-4000-8000-000000000001', '--connection', '00000000-0000-4000-8000-000000000002', '--organization', 'org-1'],
])('routes explicit organisation for automations %s %s', async (...args) => {
  const { run } = await import('../src/main.js');
  expect(await run(['automations', ...args], {}, terminal)).toBe(0);
  expect(selectedOrganization).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), terminal, 'org-1');
  const called = args[0] === 'status' ? automationStatus : args[0] === 'grant' ? automationManage : args[0] === 'create' ? githubAutomationCreate : automationSetup;
  expect(called).toHaveBeenCalledOnce();
  expect(JSON.stringify(called.mock.calls[0])).not.toContain('--organization');
});
