import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, it } from 'vitest';

const app = resolve(import.meta.dirname, '..');

async function bundleMcp() {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-mcp-stdio-'));
  const dist = join(directory, 'dist');
  await build({
    entryPoints: [join(app, 'src', 'main.ts')],
    outfile: join(dist, 'main.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    define: { __INHERITI_PRODUCTION_BUILD__: 'false', __INHERITI_DEPLOYMENT__: 'undefined' },
    banner: { js: "import { createRequire as __nodeCreateRequire } from 'node:module';\nconst require = __nodeCreateRequire(import.meta.url);" },
  });
  await cp(join(app, 'src', 'assets'), join(dist, 'assets'), { recursive: true });
  await cp(join(app, 'src', 'templates'), join(dist, 'templates'), { recursive: true });
  await cp(join(app, 'package.json'), join(directory, 'package.json'));
  return directory;
}

function testEnvironment(directory: string): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  environment.XDG_CONFIG_HOME = directory;
  return environment;
}

async function connect(directory: string, secureDelivery: boolean) {
  const client = new Client({ name: 'inheriti-mcp-stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(directory, 'dist', 'main.js'), ...(secureDelivery ? ['--enable-secure-delivery'] : [])],
    cwd: directory,
    env: testEnvironment(directory),
  });
  await client.connect(transport);
  return client;
}

it('registers the MCP tools over the real stdio transport', async () => {
  const directory = await bundleMcp();
  let client: Client | undefined;
  try {
    client = await connect(directory, false);
    const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
    expect(tools).toEqual([
      'abort_plan_access', 'check_update', 'get_backup_plan', 'list_backup_plan_logs',
      'list_backup_plans', 'list_organizations', 'logout', 'select_organization',
    ]);
    const result = await client.callTool({ name: 'check_update', arguments: {} });
    expect(result).toMatchObject({ content: [{ type: 'text', text: expect.stringContaining('"updateAvailable":false') }] });
  } finally {
    await client?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('registers secure delivery tools and returns a safe error over stdio', async () => {
  const directory = await bundleMcp();
  let client: Client | undefined;
  try {
    client = await connect(directory, true);
    const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
    expect(tools).toEqual([
      'abort_plan_access', 'check_reveal_status', 'check_update', 'download_plan_asset',
      'get_backup_plan', 'list_backup_plan_logs', 'list_backup_plans', 'list_organizations',
      'logout', 'reveal_plan_secret', 'select_organization',
    ]);
    const invalid = await client.callTool({ name: 'reveal_plan_secret', arguments: {
      planId: 'plan', selector: 'account.password', all: true,
    } });
    expect(invalid).toMatchObject({ isError: true, content: [{ type: 'text', text: 'asset_selector_invalid' }] });
    const result = await client.callTool({
      name: 'check_reveal_status',
      arguments: { jobId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'reveal_not_found' }] });
  } finally {
    await client?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects the removed delivery flag and advertises only the secure delivery flag', async () => {
  const directory = await bundleMcp();
  try {
    await expect(promisify(execFile)(process.execPath,
      [join(directory, 'dist', 'main.js'), '--local-delivery'],
      { cwd: directory, env: testEnvironment(directory) },
    )).rejects.toMatchObject({ code: 1, stdout: '', stderr: 'Usage: inheriti-mcp [--enable-secure-delivery] | --version | update [--install]\n' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
