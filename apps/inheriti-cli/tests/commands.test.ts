import { describe, expect, it, vi } from 'vitest';
import { login, loginWithDevice } from '../src/commands/login.js';
import { logout } from '../src/commands/logout.js';
import { messageFor, parsePlanHints, run } from '../src/main.js';
import { OperatorNotSignedIn, PlanIdRequired, abortPlanAccess, listPlanLogs, listPlans, resolvePlanId, showPlan } from '../src/commands/plans.js';
import { completeWords, printCompletionScript } from '../src/commands/completion.js';
import type { Terminal } from '../src/output.js';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { createNodeIntegrationCore, MemoryOperatorSessionStore } from '@safetech/inheriti-elements-core/node-base';
import type { NodeIntegrationCoreOptions } from '@safetech/inheriti-elements-core/node-base';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/** Each completion case caches into a state directory of its own, so none of them see another's. */
function temporaryState(): string {
  return mkdtempSync(resolve(tmpdir(), 'inheriti-elements-completion-'));
}

function recordingTerminal(interactive: boolean): Terminal & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, stdoutIsTTY: false, interactive, columns: 200, write: (line) => lines.push(line), writeError: (line) => errors.push(line) };
}

/** Mirrors `ElementsIntegrationCore`, which delegates `getAccessToken` from `auth` to the top level. */
function contextWith(overrides: Record<string, unknown> = {}): never {
  const cleared: string[] = [];
  const auth = {
    beginDeviceAuthorization: async () => ({ userCode: 'WDJB-MJHT', verificationUri: 'http://127.0.0.1:4564/device' }),
    pollDeviceAuthorization: async () => undefined,
    getAccessToken: async () => 'access-token',
    clear: async () => { cleared.push('auth'); },
    ...(overrides.auth as Record<string, unknown> ?? {}),
  };
  return {
    sessions: {
      clear: async () => { cleared.push('sessions'); },
      load: async () => ({ principal: { issuer: 'issuer', environment: 'TEST', subject: 'operator' } }),
    },
    cleared,
    authConfiguration: { redirectUri: 'http://127.0.0.1:53682/oauth/callback' },
    core: {
      auth,
      getAccessToken: () => auth.getAccessToken(),
      listPlans: async () => ({ items: [], nextCursor: null }),
      listPlanLogs: async () => ({ items: [], total: 0 }),
      abortPlanAccess: async () => ({ aborted: true }),
      getPlan: async () => ({ id: 'plan-1' }),
      ...overrides,
    },
  } as never;
}

describe('help', () => {
  it('accepts only bounded, catalog-backed plan hints', () => {
    expect(parsePlanHints(['--title', 'AWS access', '--description', 'Console recovery', '--asset', 'USER-PSWD'])).toEqual({ title: 'AWS access', description: 'Console recovery', assetTypes: ['USER-PSWD'] });
    expect(parsePlanHints(['--asset', 'UNKNOWN'])).toBeUndefined();
    expect(parsePlanHints(['--title', 'x'.repeat(201)])).toBeUndefined();
  });
  it('documents plan activity pagination', async () => {
    const terminal = recordingTerminal(false);
    await expect(run(['plans', 'logs', '--help'], {}, terminal)).resolves.toBe(0);
    expect(terminal.lines.join('\n')).toContain('[--limit N] [--offset N]');
  });
  it('explains reveal security and interaction behavior without configuration or sign-in', async () => {
    const terminal = recordingTerminal(true);

    await expect(run(['help', 'plans', 'reveal'], {}, terminal)).resolves.toBe(0);

    expect(terminal.errors).toEqual([]);
    expect(terminal.lines.join('\n')).toContain('Values are never printed.');
    expect(terminal.lines.join('\n')).toContain('authorized and audited independently');
  });

  it('supports conventional subcommand --help before loading configuration', async () => {
    const terminal = recordingTerminal(true);

    await expect(run(['plans', 'list', '--help'], {}, terminal)).resolves.toBe(0);

    expect(terminal.lines.join('\n')).toContain('List non-sensitive plan metadata.');
    expect(terminal.lines.join('\n')).toContain('--json never includes reconstructed secret values.');
  });

  it('documents every implemented secret destination without offering stdout', async () => {
    const terminal = recordingTerminal(true);

    await expect(run(['plans', 'use', '--help'], {}, terminal)).resolves.toBe(0);

    const help = terminal.lines.join('\n');
    expect(help).toContain('--stdin');
    expect(help).toContain('--env');
    expect(help).toContain('--fd');
    expect(help).toContain('--temp-file');
    expect(help).toContain('--socket');
    expect(help).not.toContain('--raw');
    expect(help).not.toContain('--stdout');
  });

  it('documents the machine-oriented secrets commands', async () => {
    const terminal = recordingTerminal(false);

    await expect(run(['secrets', 'exec', '--help'], {}, terminal)).resolves.toBe(0);
    expect(terminal.lines.join('\n')).toContain('reveal flow, approvals and field auditing are unchanged');

    const resolveHelp = recordingTerminal(false);
    await expect(run(['secrets', 'resolve', '--help'], {}, resolveHelp)).resolves.toBe(0);
    expect(resolveHelp.lines.join('\n')).toContain('trusted wrapper');
  });
});

describe('plan logs', () => {
  const entry = { id: 'log-1', planId: 'plan-1', tenantId: 'tenant-1', event: 'PLAN_UPDATED', occurredOn: '2026-09-20T12:00:00Z', status: 'SUCCESS', title: 'Plan updated', details: [{ label: 'Actor', value: 'Owner' }] };
  it('prints the full safe page as JSON and passes pagination to the core', async () => {
    const terminal = recordingTerminal(false);
    const calls: unknown[] = [];
    const context = contextWith({ listPlanLogs: async (id: string, options: unknown) => { calls.push([id, options]); return { items: [entry], total: 3 }; } });
    await listPlanLogs(context, terminal, 'plan-1', { format: 'json', limit: 1, offset: 2 });
    expect(calls).toEqual([['plan-1', { limit: 1, offset: 2 }]]);
    expect(JSON.parse(terminal.lines.join('\n'))).toEqual({ items: [entry], total: 3 });
  });
  it('renders event summary and details in the table', async () => {
    const terminal = recordingTerminal(false);
    await listPlanLogs(contextWith({ listPlanLogs: async () => ({ items: [entry], total: 3 }) }), terminal, 'plan-1');
    expect(terminal.lines.join('\n')).toContain('PLAN_UPDATED');
    expect(terminal.lines.join('\n')).toContain('Actor: Owner');
  });
});

describe('login', () => {
  it('does not report success when the device login did not leave a readable session', async () => {
    const terminal = recordingTerminal(true);
    const context = contextWith();
    (context as { sessions: { load: () => Promise<undefined> } }).sessions.load = async () => undefined;
    await expect(loginWithDevice(context, terminal)).rejects.toMatchObject({ code: 'session_file_unreadable' });
    expect(terminal.lines).not.toContain('Signed in.');
  });

  it('signs in through the browser and hands the whole callback back to the SDK', async () => {
    process.env.INHERITI_ELEMENTS_NO_BROWSER = '1';
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EACCES' || error.code === 'EADDRINUSE') { resolve(); return; }
        reject(error);
      });
      occupied.listen(53682, '127.0.0.1', resolve);
    });
    let redirect = '';
    let authorizationReady!: () => void;
    const ready = new Promise<void>((resolve) => { authorizationReady = resolve; });
    let completed: string | undefined;
    const terminal = recordingTerminal(true);
    const context = contextWith({
      auth: {
        beginAuthorizationCode: async () => {
          redirect = (context as unknown as { authConfiguration: { redirectUri: string } }).authConfiguration.redirectUri;
          authorizationReady();
          return { authorizationUrl: `http://127.0.0.1:4564/auth?redirect_uri=${encodeURIComponent(redirect)}`, expiresAt: 0 };
        },
        completeAuthorizationCode: async (callbackUrl: string) => { completed = callbackUrl; },
        getAccessToken: async () => 'access-token',
      },
    });

    (context as unknown as { authConfiguration: { redirectUri: string } }).authConfiguration.redirectUri
      = 'http://127.0.0.1:53682/custom/callback?tenant=business';
    try {
      const signingIn = login(context, terminal);
      // The callback the issuer would send once the operator approves in the browser.
      await ready;
      expect(new URL(redirect).port).not.toBe('53682');
      expect(new URL(redirect).pathname).toBe('/custom/callback');
      expect(new URL(redirect).searchParams.get('tenant')).toBe('business');
      const wrongPath = new URL(redirect);
      wrongPath.pathname = '/unrelated';
      expect((await fetch(wrongPath)).status).toBe(404);
      const callback = await fetch(`${redirect}&code=authorization-code&state=opaque`);
      const html = await callback.text();
      expect(html).toContain('font-family: AppFont');
      expect(html).toContain('--primary: #2962ff');
      expect(html).toContain('Inheriti® CLI');
      expect(html).toContain('Sign-in is complete only when your terminal says Signed in.');

      await expect(signingIn).resolves.toBe(0);
      expect(completed).toContain('code=authorization-code');
      expect(completed).toContain('state=opaque');
      expect(terminal.lines.at(-1)).toBe('Signed in.');
    } finally {
      if (occupied.listening) await new Promise<void>((resolve) => occupied.close(() => resolve()));
      delete process.env.INHERITI_ELEMENTS_NO_BROWSER;
    }
  });

  it('exchanges the assigned URI with state and PKCE through the real SDK', async () => {
    process.env.INHERITI_ELEMENTS_NO_BROWSER = '1';
    try {
      const configuration: NodeIntegrationCoreOptions['configuration'] = {
        issuer: 'https://issuer.test', clientId: 'cli-test', audience: 'inheriti-integrations-api',
        environment: 'TEST', redirectUri: 'http://127.0.0.1/custom/callback?tenant=business', scopes: ['openid'],
      };
      const principal = {
        issuer: configuration.issuer, audience: configuration.audience, authorizedParty: configuration.clientId,
        environment: 'TEST' as const, subject: 'operator', sessionId: 'session', tokenId: 'token', scopes: ['openid'],
      };
      let nonce = '';
      let exchanged: URLSearchParams | undefined;
      const sessions = new MemoryOperatorSessionStore();
      const core = createNodeIntegrationCore({
        apiUrl: 'https://business.test/integrations/', environment: 'TEST', business: true, configuration,
        sessions,
        tokenValidator: {
          validateAccessToken: async () => principal,
          validateIdToken: async () => Object.assign({}, principal, { audience: configuration.clientId, nonce }),
        },
        fetchImpl: async (input, init) => {
          if (String(input).endsWith('/.well-known/openid-configuration')) {
            return Response.json({ issuer: configuration.issuer, authorization_endpoint: 'https://issuer.test/authorize', token_endpoint: 'https://issuer.test/token' });
          }
          expect(String(input)).toBe('https://issuer.test/token');
          exchanged = new URLSearchParams(String(init?.body));
          return Response.json({ access_token: 'access', id_token: 'id', token_type: 'Bearer', expires_in: 3600 });
        },
      });
      let published!: (authorization: URL) => void;
      const ready = new Promise<URL>((resolve) => { published = resolve; });
      const terminal = recordingTerminal(true);
      terminal.write = (line) => {
        terminal.lines.push(line);
        if (line.startsWith('Waiting for the browser')) published(new URL(line.split('\n  ')[1]!));
      };
      const context = { core, authConfiguration: configuration, sessions } as unknown as Parameters<typeof login>[0];
      const signingIn = login(context, terminal);
      const authorization = await ready;
      expect(authorization.searchParams.get('redirect_uri')).toBe(configuration.redirectUri);
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
      nonce = authorization.searchParams.get('nonce')!;
      await fetch(`${configuration.redirectUri}&code=code&state=${encodeURIComponent(authorization.searchParams.get('state')!)}`);
      await expect(signingIn).resolves.toBe(0);
      expect(exchanged?.get('redirect_uri')).toBe(configuration.redirectUri);
      expect(exchanged?.get('code')).toBe('code');
      expect(exchanged?.get('code_verifier')).toBeTruthy();
    } finally { delete process.env.INHERITI_ELEMENTS_NO_BROWSER; }
  });

  it('closes the assigned listener when authorization fails', async () => {
    const context = contextWith({ auth: { beginAuthorizationCode: async () => { throw new Error('issuer unavailable'); } } });
    await expect(login(context, recordingTerminal(true))).rejects.toThrow('issuer unavailable');
    const redirect = (context as unknown as { authConfiguration: { redirectUri: string } }).authConfiguration.redirectUri;
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it('times out pending authorization without printing a late browser URL', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let started!: () => void;
      const ready = new Promise<void>((resolve) => { started = resolve; });
      let finishAuthorization!: (value: { authorizationUrl: string }) => void;
      const pending = new Promise<{ authorizationUrl: string }>((resolve) => { finishAuthorization = resolve; });
      const context = contextWith({ auth: { beginAuthorizationCode: () => { started(); return pending; } } });
      const terminal = recordingTerminal(true);
      const signingIn = login(context, terminal);
      const result = expect(signingIn).rejects.toThrow('login_browser_callback_timed_out');
      await ready;
      await vi.advanceTimersByTimeAsync(300_000);
      await result;
      finishAuthorization({ authorizationUrl: 'https://issuer.test/late' });
      await Promise.resolve();
      expect(terminal.lines).toEqual([]);
      const redirect = (context as unknown as { authConfiguration: { redirectUri: string } }).authConfiguration.redirectUri;
      await expect(fetch(redirect)).rejects.toThrow();
    } finally { vi.useRealTimers(); }
  });

  it('rejects a callback outside HTTP IPv4 loopback', async () => {
    const context = contextWith();
    (context as unknown as { authConfiguration: { redirectUri: string } }).authConfiguration.redirectUri = 'https://example.com/oauth/callback';
    await expect(login(context, recordingTerminal(true))).rejects.toThrow('login_requires_an_http_ipv4_loopback_callback');
  });

  it('shows the verification URI and code when signing in headlessly', async () => {
    const terminal = recordingTerminal(true);
    await expect(loginWithDevice(contextWith(), terminal)).resolves.toBe(0);
    expect(terminal.lines[0]).toContain('http://127.0.0.1:4564/device');
    expect(terminal.lines[0]).toContain('WDJB-MJHT');
    expect(terminal.lines.at(-1)).toBe('Signed in.');
  });

  it('prints the device instructions in a non-interactive shell for headless login', async () => {
    const terminal = recordingTerminal(false);
    await expect(loginWithDevice(contextWith(), terminal)).resolves.toBe(0);
    expect(terminal.lines[0]).toContain('http://127.0.0.1:4564/device');
    expect(terminal.lines[0]).toContain('WDJB-MJHT');
    expect(terminal.lines.at(-1)).toBe('Signed in.');
  });
});

describe('logout', () => {
  it('clears both the SDK session and the file, even when the SDK throws', async () => {
    const context = contextWith({ auth: { clear: async () => { throw new Error('already gone'); } } });
    const terminal = recordingTerminal(true);
    await expect(logout(context, terminal)).rejects.toBeTruthy();
    expect((context as unknown as { cleared: string[] }).cleared).toContain('sessions');
  });
});

describe('plans', () => {
  it('says so plainly when the Application has no plans', async () => {
    const terminal = recordingTerminal(true);
    await expect(listPlans(contextWith(), terminal)).resolves.toBe(0);
    expect(terminal.lines).toEqual(['No plans in this Application.']);
  });

  it('renders real plan rows as JSON when asked for it', async () => {
    const items = [{ id: 'plan-1', name: 'Family vault', status: 'ACTIVE' }];
    const terminal = recordingTerminal(true);
    await listPlans(
      contextWith({ listPlans: async () => ({ items, nextCursor: null }) }),
      terminal,
      { format: 'json' },
    );
    expect(JSON.parse(terminal.lines[0] as string).items).toEqual(items);
  });

  it('lays the listing out as a table by default', async () => {
    const items = [{
      id: 'plan-1',
      name: 'Family vault',
      status: { kind: 'UNKNOWN', raw: 'PROTECTED' },
      createdAt: '2026-08-31T14:12:28.000Z',
      assetSummary: { count: 2, types: ['SEED-PHRASE'], names: ['Wallet seed', 'Recovery sheet'] },
      governance: { mode: 'DIRECT', minimumApprovals: 1 },
      participantSummary: { owners: 1, mergers: 1, moderators: 2 },
      authentication: [{ id: 'SK_MOBILE', status: 'ACTIVE' }],
    }];
    const terminal = recordingTerminal(true);
    await listPlans(contextWith({ listPlans: async () => ({ items, nextCursor: null }) }), terminal);
    const output = terminal.lines.join('\n');
    expect(output).toContain('NAME');
    expect(output).toContain('Family vault');
    // The engine's own word, not the SDK's `UNKNOWN` wrapper around it.
    expect(output).toContain('PROTECTED');
    expect(output).not.toContain('UNKNOWN');
    // What the assets are called, not the type codes several plans share.
    expect(output).toContain('Wallet seed, Recovery sheet');
    expect(output).toContain('SK_MOBILE');
    // The engine's own governance word is an internal detail and has no column.
    expect(output).not.toContain('BYPASS');
  });

  it('keeps the pagination cursor out of the table and in the JSON', async () => {
    const items = [{ id: 'plan-1', name: 'Family vault', status: 'ACTIVE', createdAt: '2026-08-31T14:12:28.000Z' }];
    const cursor = 'eyJhIjoiMjAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIn0';
    const context = contextWith({ listPlans: async () => ({ items, nextCursor: cursor }) });

    const table = recordingTerminal(true);
    await listPlans(context, table);
    expect(table.lines.join('\n')).not.toContain(cursor);
    expect(table.lines.join('\n')).toContain('more available');

    const json = recordingTerminal(true);
    await listPlans(context, json, { format: 'json' });
    expect(JSON.parse(json.lines[0] as string).nextCursor).toBe(cursor);
  });

  it('follows the cursor itself when asked for every page', async () => {
    const pages = [
      { items: [{ id: 'plan-1', name: 'One', status: 'ACTIVE' }], nextCursor: 'cursor-2' },
      { items: [{ id: 'plan-2', name: 'Two', status: 'ACTIVE' }], nextCursor: null },
    ];
    const seen: Array<string | undefined> = [];
    const terminal = recordingTerminal(true);
    await listPlans(
      contextWith({
        listPlans: async (input?: { cursor?: string }) => {
          seen.push(input?.cursor);
          return pages[seen.length - 1];
        },
      }),
      terminal,
      { format: 'json', all: true },
    );
    expect(seen).toEqual([undefined, 'cursor-2']);
    expect(JSON.parse(terminal.lines[0] as string).items).toHaveLength(2);
  });

  it('never prints a token that arrives inside a plan payload', async () => {
    const terminal = recordingTerminal(true);
    await showPlan(contextWith({
      getPlan: async () => ({ id: 'plan-1', accessToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJvcCJ9.signature' }),
    }), terminal, 'plan-1', { format: 'json' });
    expect(terminal.lines[0]).toContain('<redacted>');
    expect(terminal.lines[0]).not.toContain('eyJhbGciOiJSUzI1NiJ9');
  });

  it('shows assets and participants as their own tables', async () => {
    const terminal = recordingTerminal(true);
    await showPlan(contextWith({
      getPlan: async () => ({
        id: 'plan-1',
        name: 'Family vault',
        status: 'ACTIVE',
        createdAt: '2026-08-31T14:12:28.000Z',
        assetSummary: { count: 1, types: ['SEED-PHRASE'] },
        governance: { mode: 'DIRECT', minimumApprovals: 1 },
        participantSummary: { owners: 1, mergers: 0, moderators: 1 },
        assets: [{
          id: 'asset-1', code: 'wallet-seed', type: 'SEED-PHRASE', name: 'Wallet seed',
          isBinary: false, fieldNames: ['words'],
        }],
        participants: [{
          id: 'participant-1', displayName: 'Willow Owner',
          relationships: ['OWNER', 'MODERATOR'], lifecycle: 'ACTIVE',
        }],
        authentication: [{ id: 'SK_MOBILE', status: 'ACTIVE' }],
        revealPolicy: { masterKeyRelease: 'REQUIRED', custodian: 'FORCE' },
        source: { kind: 'NATIVE' },
      }),
    }), terminal, 'plan-1');
    const output = terminal.lines.join('\n');
    expect(output).toContain('Assets (1)');
    expect(output).toContain('wallet-seed');
    expect(output).toContain('words');
    expect(output).toContain('Participants (1)');
    expect(output).toContain('Willow Owner');
    expect(output).toContain('OWNER, MODERATOR');
    expect(output).toContain('SK_MOBILE (ACTIVE)');
    expect(output).toContain('1 · Willow Owner');
  });

  it('names the file behind a binary asset, and marks one that never declared a name', async () => {
    const terminal = recordingTerminal(true);
    await showPlan(contextWith({
      getPlan: async () => ({
        id: 'plan-1',
        name: 'Estate documents',
        status: 'ACTIVE',
        createdAt: '2026-08-31T14:12:28.000Z',
        assetSummary: { count: 2, types: ['DOCUMENT'], names: ['Will', 'Deed'] },
        governance: { mode: 'DIRECT', minimumApprovals: 0 },
        participantSummary: { owners: 1, mergers: 1, moderators: 0 },
        authentication: [],
        assets: [
          {
            id: 'will', code: 'will', type: 'DOCUMENT', name: 'Will', isBinary: true,
            fieldNames: [], fileName: 'last-will.pdf', mimeType: 'application/pdf',
          },
          { id: 'deed', code: 'deed', type: 'DOCUMENT', name: 'Deed', isBinary: true, fieldNames: [] },
        ],
        participants: [],
        revealPolicy: { masterKeyRelease: 'REQUIRED', custodian: 'FORCE' },
        source: { kind: 'NATIVE' },
      }),
    }), terminal, 'plan-1');
    const output = terminal.lines.join('\n');
    expect(output).toContain('last-will.pdf · application/pdf');
    expect(output).toContain('(file)');
    expect(output).toContain('authentication');
    expect(output).toContain('none');
  });

  it('reports a missing session as a signed-out state, not as a request failure', async () => {
    const context = contextWith({ auth: { getAccessToken: async () => undefined } });
    await expect(listPlans(context, recordingTerminal(true))).rejects.toBeInstanceOf(OperatorNotSignedIn);
  });
});

describe('completion', () => {
  it('prints a script a shell can source, and refuses a shell it has none for', async () => {
    const terminal = recordingTerminal(true);
    expect(printCompletionScript(terminal, 'bash')).toBe(0);
    expect(terminal.lines[0]).toContain('-F _inheriti_complete inheriti');
    expect(printCompletionScript(terminal, 'powershell')).toBe(1);
    expect(terminal.errors[0]).toContain('bash|zsh|fish');
  });

  it('offers commands, subcommands and plan ids at their actual shell cursor positions', async () => {
    const terminal = recordingTerminal(true);
    const items = [{ id: 'plan-1', name: 'Family vault' }, { id: 'plan-2', name: 'Recovery kit' }];
    const context = contextWith({ listPlans: async () => ({ items, nextCursor: null }) });
    await completeWords(context, terminal, ['pl'], { XDG_STATE_HOME: temporaryState() });
    expect(terminal.lines).toContain('plans\tList and use plans');
    terminal.lines.length = 0;
    await completeWords(context, terminal, ['plans', ''], { XDG_STATE_HOME: temporaryState() });
    expect(terminal.lines).toContain('create\tCreate a plan with the local assistant');
    expect(terminal.lines).toContain('show\tShow plan details');
    terminal.lines.length = 0;
    await completeWords(
      context,
      terminal,
      ['plans', 'show', ''],
      { XDG_STATE_HOME: temporaryState() },
    );
    expect(terminal.lines).toEqual(['plan-1\tFamily vault', 'plan-2\tRecovery kit']);
  });

  it.each(['logs', 'reveal', 'download', 'use', 'abort'])('offers plan ids after `plans %s`', async (command) => {
    const terminal = recordingTerminal(true);
    await completeWords(
      contextWith({ listPlans: async () => ({ items: [{ id: 'plan-1', name: 'Family vault' }], nextCursor: null }) }),
      terminal,
      ['plans', command, ''],
      { XDG_STATE_HOME: temporaryState() },
    );
    expect(terminal.lines).toEqual(['plan-1\tFamily vault']);
  });

  it('offers plan ids while a plan id is partially typed', async () => {
    const terminal = recordingTerminal(true);
    await completeWords(
      contextWith({ listPlans: async () => ({ items: [{ id: 'cd123', name: 'Family vault' }], nextCursor: null }) }),
      terminal,
      ['plans', 'reveal', 'cd'],
      { XDG_STATE_HOME: temporaryState() },
    );
    expect(terminal.lines).toEqual(['cd123\tFamily vault']);
  });

  it('offers command options after a plan id', async () => {
    const terminal = recordingTerminal(true);
    await completeWords(contextWith(), terminal, ['plans', 'logs', 'plan-1', ''], { XDG_STATE_HOME: temporaryState() });
    expect(terminal.lines).toEqual(expect.arrayContaining(['--limit\t', '--offset\t', '--json\t', '--table\t']));
  });

  it('offers organization ids where an organization value is expected', async () => {
    const terminal = recordingTerminal(true);
    const context = contextWith({
      listOrganizations: async () => [{ id: 'org-1', name: 'Acme' }],
    });
    await completeWords(context, terminal, ['organizations', 'use', ''], { XDG_STATE_HOME: temporaryState() });
    expect(terminal.lines).toEqual(['org-1\tAcme']);
  });

  it('offers the asset selectors of the plan already on the line after --field', async () => {
    const terminal = recordingTerminal(true);
    await completeWords(
      contextWith({
        getPlan: async () => ({
          assets: [{ id: 'a', code: 'wallet-seed', name: 'Wallet seed', fieldNames: ['words'] }],
        }),
      }),
      terminal,
      ['plans', 'reveal', 'plan-1', '--field', ''],
      { XDG_STATE_HOME: temporaryState() },
    );
    expect(terminal.lines).toEqual(['wallet-seed.words\tWallet seed']);
  });

  it('offers fields for the machine-oriented resolve command too', async () => {
    const terminal = recordingTerminal(true);
    await completeWords(
      contextWith({
        getPlan: async () => ({ assets: [{ id: 'a', code: 'database', fieldNames: ['password'] }] }),
      }),
      terminal,
      ['secrets', 'resolve', 'plan-1', '--field', ''],
      { XDG_STATE_HOME: temporaryState() },
    );
    expect(terminal.lines).toEqual(['database.password\t']);
  });

  it('preserves a mapping name while completing its field selector', async () => {
    const terminal = recordingTerminal(true);
    await completeWords(
      contextWith({ getPlan: async () => ({ assets: [{ id: 'a', code: 'database', fieldNames: ['password'] }] }) }),
      terminal,
      ['plans', 'use', 'plan-1', '--env', 'DATABASE_URL='],
      { XDG_STATE_HOME: temporaryState() },
    );
    expect(terminal.lines).toEqual(['DATABASE_URL=database.password\t']);
  });

  it('offers binary and structured asset codes after download --asset', async () => {
    const terminal = recordingTerminal(true);
    await completeWords(
      contextWith({ getPlan: async () => ({ assets: [
        { id: 'asset-1', code: 'contract', name: 'Contract', fieldNames: [], isBinary: true },
        { id: 'asset-2', code: 'database', name: 'Database', fieldNames: ['password'], isBinary: false },
      ] }) }),
      terminal,
      ['plans', 'download', 'plan-1', '--asset', ''],
      { XDG_STATE_HOME: temporaryState() },
    );
    expect(terminal.lines).toEqual(['contract\tContract', 'database\tDatabase']);
  });

  it('answers nothing, successfully, when there is no session to ask with', async () => {
    const terminal = recordingTerminal(true);
    const context = contextWith({ auth: { getAccessToken: async () => undefined } });
    await expect(completeWords(context, terminal, ['plans', 'show', ''], { XDG_STATE_HOME: temporaryState() }))
      .resolves.toBe(0);
    expect(terminal.lines).toEqual([]);
  });

  it('stays silent when the API refuses, rather than corrupting the line being typed', async () => {
    const terminal = recordingTerminal(true);
    const context = contextWith({ listPlans: async () => { throw new Error('plan_request_failed'); } });
    await expect(completeWords(context, terminal, ['plans', 'show', ''], { XDG_STATE_HOME: temporaryState() }))
      .resolves.toBe(0);
    expect(terminal.lines).toEqual([]);
    expect(terminal.errors).toEqual([]);
  });
});

describe('choosing a plan', () => {
  it('explains an unavailable API instead of showing TypeError', () => {
    const error = new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ECONNREFUSED' }) });
    expect(messageFor(error, true)).toBe('Cannot connect to the Inheriti API.');
  });

  it('refuses a missing plan id in a pipe, with the message an operator can act on', async () => {
    const terminal = recordingTerminal(false);
    await expect(resolvePlanId(contextWith(), terminal, undefined)).rejects.toBeInstanceOf(PlanIdRequired);
    expect(messageFor(new PlanIdRequired())).toContain('Pass a plan id');
  });

  it('takes the plan id it was given without asking anything', async () => {
    const terminal = recordingTerminal(true);
    await expect(resolvePlanId(contextWith(), terminal, 'plan-1')).resolves.toBe('plan-1');
  });
});

describe('plans abort', () => {
  it('reports the access it gave up, so the operator knows the next reveal starts clean', async () => {
    const terminal = recordingTerminal(true);

    await abortPlanAccess(contextWith(), terminal, 'plan-1');

    expect(terminal.lines).toEqual([
      'Access aborted. The next reveal of this plan will start a new request.',
    ]);
  });

  // Nothing open is the state the operator asked for, not a failure to report as one.
  it('says so plainly when no access was open', async () => {
    const terminal = recordingTerminal(true);
    const context = contextWith({ abortPlanAccess: async () => ({ aborted: false }) });

    await expect(abortPlanAccess(context, terminal, 'plan-1')).resolves.toBe(0);

    expect(terminal.lines).toEqual(['No access is open on this plan.']);
  });

  it('refuses without a session rather than calling Elements', async () => {
    const context = contextWith({ auth: { getAccessToken: async () => undefined } });

    await expect(abortPlanAccess(context, recordingTerminal(true), 'plan-1')).rejects.toThrow(OperatorNotSignedIn);
  });
});
