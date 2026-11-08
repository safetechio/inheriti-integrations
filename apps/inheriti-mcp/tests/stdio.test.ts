import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, it } from 'vitest';

const app = resolve(import.meta.dirname, '..');

async function bundleMcp(deployment?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-mcp-stdio-'));
  const dist = join(directory, 'dist');
  await build({
    entryPoints: [join(app, 'src', 'main.ts')],
    outfile: join(dist, 'main.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['@google-cloud/secret-manager', 'cbor-extract'],
    define: {
      __INHERITI_PRODUCTION_BUILD__: 'false',
      __INHERITI_DEPLOYMENT__: deployment === undefined ? 'undefined' : JSON.stringify(deployment),
    },
    banner: { js: "import { createRequire as __nodeCreateRequire } from 'node:module';\nconst require = __nodeCreateRequire(import.meta.url);" },
  });
  await cp(join(app, 'src', 'assets'), join(dist, 'assets'), { recursive: true });
  await cp(join(app, 'src', 'templates'), join(dist, 'templates'), { recursive: true });
  await cp(join(app, 'package.json'), join(directory, 'package.json'));
  await mkdir(join(directory, 'node_modules', '@google-cloud'), { recursive: true });
  await symlink(realpathSync(join(app, '../../packages/core/node_modules/@google-cloud/secret-manager')),
    join(directory, 'node_modules', '@google-cloud', 'secret-manager'), 'dir');
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

it('registers only always-on tools by default over the real stdio transport', async () => {
  const directory = await bundleMcp();
  let client: Client | undefined;
  try {
    client = await connect(directory, false);
    const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
    expect(tools).toEqual([
      'abort_plan_access', 'check_update',
      'get_backup_plan', 'get_organization_insights', 'get_plan_responsibilities', 'list_backup_plan_logs', 'list_backup_plans', 'list_member_logs', 'list_organization_audit_trail', 'list_organization_members', 'list_organizations',
      'logout', 'select_organization',
    ]);
    const result = await client.callTool({ name: 'check_update', arguments: {} });
    expect(result).toMatchObject({ content: [{ type: 'text', text: expect.stringContaining('"updateAvailable":false') }] });
  } finally {
    await client?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it.each(['local', 'dev', 'stg', 'prod'])('omits automation tools over real stdio in %s', async deployment => {
  const directory = await bundleMcp(deployment);
  let client: Client | undefined;
  try {
    client = await connect(directory, false);
    const registered = (await client.listTools()).tools;
    const tools = registered.map(tool => tool.name).sort();
    expect(tools).toEqual([
      'abort_plan_access', 'check_update', 'get_backup_plan', 'get_organization_insights', 'get_plan_responsibilities', 'list_backup_plan_logs', 'list_backup_plans',
      'list_member_logs', 'list_organization_audit_trail', 'list_organization_members', 'list_organizations', 'logout', 'select_organization',
    ]);
    const result = await client.callTool({
      name: 'check_automation_setup_status',
      arguments: { jobId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(result).toMatchObject({ isError: true });
  } finally {
    await client?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it('keeps the old flag working and returns a safe error over stdio', async () => {
  const directory = await bundleMcp();
  let client: Client | undefined;
  try {
    client = await connect(directory, true);
    const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
    expect(tools).toEqual([
      'abort_plan_access', 'check_update',
      'get_backup_plan', 'get_organization_insights', 'get_plan_responsibilities', 'list_backup_plan_logs', 'list_backup_plans', 'list_member_logs', 'list_organization_audit_trail', 'list_organization_members', 'list_organizations',
      'logout', 'select_organization',
    ]);
  } finally {
    await client?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects the removed delivery flag', async () => {
  const directory = await bundleMcp();
  try {
    await expect(promisify(execFile)(process.execPath,
      [join(directory, 'dist', 'main.js'), '--local-delivery'],
      { cwd: directory, env: testEnvironment(directory) },
    )).rejects.toMatchObject({ code: 1, stdout: '', stderr: 'Usage: inheriti-mcp | --version | update [--install]\n' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each(['local', 'dev', 'stg', 'prod'])('omits plan creation and content release in %s', async deployment => {
  const directory = await bundleMcp(deployment);
  let client: Client | undefined;
  try {
    client = await connect(directory, true);
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).not.toContain('create_plan_with_assistant');
    expect(names).not.toContain('check_plan_creation_status');
    expect(names).not.toContain('reveal_plan_secret');
    expect(names).not.toContain('download_plan_asset');
    expect(names).not.toContain('check_reveal_status');
    expect(names).not.toContain('open_inheriti_file');
    expect(names).not.toContain('publish_plan_fields_to_aws');
    expect(names).not.toContain('publish_plan_fields_to_google_cloud');
    expect(names).toContain('abort_plan_access');
    expect(names).toContain('get_backup_plan');
  } finally {
    await client?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
