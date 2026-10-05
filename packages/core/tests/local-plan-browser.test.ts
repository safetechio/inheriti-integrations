import { describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { runLocalPlanBrowser } from '../src/local-plan-browser.js';
import { localPlanQuestions } from '../src/local-plan-draft.js';
import { quickPlanAssetCatalog } from '../src/quick-plan.js';
import { assetIconCodePoints } from '../src/asset-metadata.js';

const asset = quickPlanAssetCatalog.find((item) => item.fields.length)!;
const field = asset.fields[0]!;
const candidateMetadata = (candidates: readonly { id: string; label: string }[]) => {
  const plan = candidates.find(candidate => /^(?:plan name|plan title|title|nombre del plan|t[ií]tulo del plan)$/iu.test(candidate.label));
  const ignored = candidates.filter(candidate => /^(?:plan description|description|assets?|values?|possible asset types|descripci[oó]n(?: del plan)?)$/iu.test(candidate.label));
  return { ...(plan ? { planNameValueId: plan.id } : {}), ...(ignored.length ? { ignored: ignored.map(candidate => candidate.id) } : {}) };
};
const model = { infer: async ({ sources, candidates }: { sources: readonly { id: string; kind: string; text?: string }[]; candidates?: readonly { id: string; label: string }[] }) => {
  if (candidates?.length) {
    const namedValue = candidates.find(candidate => candidate.label === 'Value'
      && sources.some(source => source.kind === 'message' && /\b(?:called|named|llamado)\b/iu.test(source.text ?? '')));
    const metadata = candidateMetadata(candidates);
    const output = { title: 'Safe plan', ...metadata, ...(namedValue ? { planNameValueId: namedValue.id } : {}), groups: candidates
      .filter(candidate => candidate.id !== namedValue?.id && !/^(?:plan name|plan title|title|plan description|description|assets?|values?|possible asset types|descripci[oó]n(?: del plan)?)$/iu.test(candidate.label))
    .map(candidate => ({ name: 'Account', members: [{ id: candidate.id, role: 'unknown' }] })) };
    return output;
  }
  const source = sources.at(-1)!;
  return { title: 'Safe plan', asset: { type: asset.id, name: 'Account', fields: { [field]: { sourceId: source.id, start: source.text!.indexOf('secret'), end: source.text!.indexOf('secret') + 6 } } }, questions: [], unassignedSources: [] };
} };

const start = async (create: (input: { title: string; asset: { secret: Record<string, string> } }) => Promise<{ id?: string; planId?: string; status?: string }> = async () => ({ id: 'created' })) => {
  let url = '';
  const signal = new AbortController();
  const result = runLocalPlanBrowser({ model, create, open: (value) => { url = value; }, signal: signal.signal });
  void result.catch(() => {});
  while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
  return { url, result, signal };
};
const form = (html: string, action: string, extra = '') => `csrf=${/name="csrf" value="([^"]+)"/.exec(html)![1]}&action=${action}${extra}`;

 describe('local plan browser', () => {
  it('has a bundled icon for every Core SDK asset type', () => {
    expect(quickPlanAssetCatalog).toHaveLength(12);
    for (const definition of quickPlanAssetCatalog) expect(assetIconCodePoints[definition.iconName]).toBeTypeOf('number');
  });
  it('shows hints in review and saves the reviewed description', async () => {
    let url = '';
    let received: { title: string; description?: string; assets: { secret: Record<string, string> }[] } | undefined;
    let modelHints: unknown;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({
      hints: { title: 'AWS access', description: 'Console recovery', assetTypes: ['USER-PSWD'] },
      model: { infer: async ({ sources, hints, candidates }) => {
        if (!candidates?.length) modelHints = hints;
        if (candidates?.length) return { title: 'Generic plan', ...candidateMetadata(candidates), groups: [{ name: 'Console login', members: [{ id: candidates.find(candidate => /password/iu.test(candidate.label))!.id, role: 'password' }] }] };
        const source = sources[0]!;
        const text = 'synthetic-secret';
        const start = source.kind === 'message' ? source.text.indexOf(text) : -1;
        return { title: 'Generic plan', asset: { type: 'USER-PSWD', name: 'Console login', fields: { password: { sourceId: source.id, start, end: start + text.length } } }, questions: [], unassignedSources: [] };
      } },
      create: async input => { received = input as typeof received; return { id: 'created' }; },
      open: value => { url = value; }, signal: signal.signal,
    });
    void result.catch(() => {});
    while (!url) await new Promise(resolve => setTimeout(resolve, 1));
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const initial = await (await fetch(url)).text();
      expect(initial).toContain('Describe assets');
      expect(initial).not.toContain('name="titleHint"');
      expect(initial).not.toContain('name="descriptionHint"');
      expect(initial).not.toContain('name="assetHint"');
      expect(initial).not.toContain('Plan name: AWS access');
      expect(initial).not.toContain('Console recovery');
      const body = new FormData();
      body.set('csrf', /name="csrf" value="([^"]+)"/.exec(initial)![1]!);
      body.set('action', 'infer');
      body.set('message', 'password: "synthetic-secret"');
      const response = await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin }, body });
      expect(response.status).toBe(200);
      const reviewed = await response.text();
      expect(modelHints).toBeUndefined();
      expect(reviewed).toContain('value="AWS access"');
      expect(reviewed).toContain('Console recovery');
      const rejected = await fetch(url, { method: 'POST', headers, body: form(reviewed, 'create', '&title=AWS%20access&description=synthetic-secret&name=Console%20login') });
      expect(rejected.status).toBe(400);
      await fetch(url, { method: 'POST', headers, body: form(reviewed, 'create', '&title=AWS%20access&description=Console%20recovery&name=Console%20login') });
      await expect(result).resolves.toEqual({ id: 'created' });
      expect(received).toMatchObject({ title: 'AWS access', description: 'Console recovery', assets: [{ secret: { password: 'synthetic-secret' } }] });
    } finally { signal.abort(); }
  });
  it('lets explicit plan details override review hints', async () => {
    let url = '';
    let seenMessage = '';
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ hints: { title: 'Old hint', description: 'Old purpose', assetTypes: ['API-KEY'] },
      model: { infer: async ({ sources, hints, candidates }) => {
        seenMessage = sources[0]?.kind === 'message' ? sources[0].text : '';
        expect(hints).toBeUndefined();
        if (candidates?.length) return { title: 'New plan', ...candidateMetadata(candidates), groups: [{ name: 'New account', members: [{ id: candidates.find(candidate => /password/iu.test(candidate.label))!.id, role: 'password' }] }] };
        const start = seenMessage.indexOf('secret');
        return { title: 'New plan', asset: { type: 'USER-PSWD', name: 'New account', fields: { password: { sourceId: sources[0]!.id, start, end: start + 6 } } }, questions: [], unassignedSources: [] };
      } }, create: async () => ({ id: 'created' }), open: value => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise(resolve => setTimeout(resolve, 1));
    try {
      const initial = await (await fetch(url)).text();
      expect(initial).not.toContain('Old hint');
      const response = await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form(initial, 'infer', '&message=Plan%20name%3A%20New%20plan%0Apassword%3A%20%22secret%22') });
      expect(response.status).toBe(200);
      const reviewed = await response.text();
      expect(seenMessage).not.toContain('Old hint');
      expect(reviewed).toContain('value="New plan"');
      expect(reviewed).toContain('Old purpose');
    } finally { signal.abort(); await expect(result).rejects.toThrow('local_plan_canceled'); }
  });
  it('uses an explicit description in the message ahead of a CLI/MCP hint', async () => {
    let url = '';
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model, hints: { description: 'Old hint' }, create: async () => ({ id: 'created' }),
      open: value => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise(resolve => setTimeout(resolve, 1));
    try {
      const initial = await (await fetch(url)).text();
      const reviewed = await (await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form(initial, 'infer', '&message=Description%3A%20New%20purpose%0Apassword%3A%20%22secret%22') })).text();
      expect(reviewed).toContain('New purpose');
      expect(reviewed).not.toContain('Old hint');
    } finally { signal.abort(); await expect(result).rejects.toThrow('local_plan_canceled'); }
  });
  it('asks for a missing detail without claiming a suggestion is ready', async () => {
    let url = '';
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async () => ({ questions: [localPlanQuestions[3]], unassignedSources: [] }) },
      create: async () => ({ id: 'unexpected' }), open: (value) => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    try {
      const initial = await (await fetch(url)).text();
      const response = await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin,
        'Content-Type': 'application/x-www-form-urlencoded' }, body: form(initial, 'infer', '&message=Use%20a%20password') });
      const html = await response.text();
      expect(html).toContain('Add one detail');
      expect(html).toContain('Add only the missing detail.');
      expect(html).toContain('Previous input saved · View');
      expect(html).toContain('Use a password');
      expect(html).toContain('Your answer');
      expect(html).toContain('Set up manually');
      expect(html).not.toContain('Message 1');
      expect(html).toContain("I couldn&#39;t tell what you want to protect yet.");
      expect(html).not.toContain('Suggestion ready');
    } finally { signal.abort(); await expect(result).rejects.toThrow('local_plan_canceled'); }
  });

  it('lets a user skip clarification and review the retained input manually', async () => {
    let url = '';
    let created: { asset: { secret: Record<string, string> } } | undefined;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async () => ({ questions: [localPlanQuestions[2]], unassignedSources: [] }) },
      create: async (input) => { created = input as typeof created; return { id: 'created' }; }, open: (value) => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const initial = await (await fetch(url)).text();
      expect(initial).toContain('Set up manually');
      const described = await (await fetch(url, { method: 'POST', headers, body: form(initial, 'infer', '&message=password%3A%20%22synthetic-original%22') })).text();
      expect(described).toContain('Previous input saved · View');
      const reviewed = await (await fetch(url, { method: 'POST', headers, body: form(described, 'review') })).text();
      expect(reviewed).toContain('Review plan');
      expect(reviewed).toContain('value="USER-PSWD" selected');
      expect(reviewed).toContain('View previous input');
      expect(reviewed).toContain('password: &quot;synthetic-original&quot;');
      expect(reviewed).not.toContain('Message 1');
      const createdResponse = await fetch(url, { method: 'POST', headers, body: form(reviewed, 'create', '&title=Test&name=Account&field%3Apassword=synthetic-new') });
      expect(createdResponse.status).toBe(200);
      await expect(result).resolves.toEqual({ id: 'created' });
      expect(created?.asset.secret.password).toBe('synthetic-new');
    } finally { signal.abort(); }
  });
  it('starts manual setup immediately and creates two assets without calling the model', async () => {
    let url = '';
    let calls = 0;
    let created: { assets: { secret: Record<string, string> }[] } | undefined;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async () => { calls++; throw new Error('Unexpected inference'); } },
      create: async input => { created = input as typeof created; return { id: 'created' }; }, open: value => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise(resolve => setTimeout(resolve, 1));
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const initial = await (await fetch(url)).text();
      expect(initial).toContain('Set up manually');
      const reviewed = await (await fetch(url, { method: 'POST', headers, body: form(initial, 'review') })).text();
      expect(reviewed).toContain('data-manual-assets');
      expect(reviewed).toContain('Add asset');
      const response = await fetch(url, { method: 'POST', headers, body: form(reviewed, 'create',
        '&manualAssetCount=2&title=Recovery&name=Login&type%3A0=USER-PSWD&field%3Apassword=synthetic-password&name%3A1=API&type%3A1=API-KEY&field%3A1%3AapiKey=synthetic-key') });
      expect(response.status).toBe(200);
      await expect(result).resolves.toEqual({ id: 'created' });
      expect(calls).toBe(0);
      expect(created?.assets.map(asset => asset.secret)).toEqual([{ password: 'synthetic-password' }, { apiKey: 'synthetic-key' }]);
    } finally { signal.abort(); }
  });
  it('suggests fields inside a manual asset without creating a plan', async () => {
    const session = await start();
    const headers = { Origin: new URL(session.url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const initial = await (await fetch(session.url)).text();
      const manual = await (await fetch(session.url, { method: 'POST', headers, body: form(initial, 'review') })).text();
      expect(manual).toContain('data-suggest-asset');
      expect(manual).toContain('data-add-asset');
      const csrf = /name="csrf" value="([^"]+)"/.exec(manual)![1]!;
      const suggested = await fetch(session.url, { method: 'POST', headers, body: new URLSearchParams({ csrf, action: 'suggest-asset',
        assetType: 'USER-PSWD', assetPrompt: 'Username: synthetic-user\nPassword: synthetic-password' }) });
      expect(suggested.status).toBe(200);
      expect((await suggested.json()).fields).toEqual({ username: 'synthetic-user', password: 'synthetic-password' });
      const plain = await fetch(session.url, { method: 'POST', headers, body: new URLSearchParams({ csrf, action: 'suggest-asset',
        assetType: 'PLAIN-TEXT', assetPrompt: 'CUSTOM_VALUE=synthetic-value' }) });
      expect((await plain.json()).fields).toEqual({ text: 'CUSTOM_VALUE=synthetic-value' });
    } finally { session.signal.abort(); await expect(session.result).rejects.toThrow('local_plan_canceled'); }
  });
  it('retries manual multi-asset creation without losing the submitted values', async () => {
    let url = '';
    let calls = 0;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async () => { throw new Error('Unexpected inference'); } },
      create: async input => { calls++; if (calls === 1) throw new Error('Temporary failure');
        expect(input.assets.map(asset => asset.secret)).toEqual([{ password: 'synthetic-password' }, { apiKey: 'synthetic-key' }]); return { id: 'created' }; },
      open: value => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise(resolve => setTimeout(resolve, 1));
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const initial = await (await fetch(url)).text();
      const reviewed = await (await fetch(url, { method: 'POST', headers, body: form(initial, 'review') })).text();
      const submit = form(reviewed, 'create', '&manualAssetCount=2&title=Recovery&name=Login&type%3A0=USER-PSWD&field%3Apassword=synthetic-password&name%3A1=API&type%3A1=API-KEY&field%3A1%3AapiKey=synthetic-key');
      expect((await fetch(url, { method: 'POST', headers, body: submit })).status).toBe(500);
      expect((await fetch(url, { method: 'POST', headers, body: submit })).status).toBe(200);
      await expect(result).resolves.toEqual({ id: 'created' });
      expect(calls).toBe(2);
    } finally { signal.abort(); }
  });
  it('stops repeating the same clarification after a follow-up answer', async () => {
    let url = '';
    let calls = 0;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async () => { calls++; return { questions: [localPlanQuestions[3]], unassignedSources: [] }; } },
      create: async () => ({ id: 'unexpected' }), open: (value) => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const initial = await (await fetch(url)).text();
      const clarification = await (await fetch(url, { method: 'POST', headers, body: form(initial, 'infer', '&message=Create%20a%20plan%20called%20Recovery') })).text();
      expect(clarification).toContain("I couldn&#39;t tell what you want to protect yet.");
      const reviewed = await (await fetch(url, { method: 'POST', headers, body: form(clarification, 'infer', '&message=The%20value%20is%20synthetic-aws-secret') })).text();
      expect(reviewed).toContain('Review plan');
      expect(reviewed).toContain('value="PLAIN-TEXT" selected');
      expect(reviewed).toContain('value="Recovery"');
      expect(reviewed).toContain('View previous input');
      expect(reviewed).not.toContain("I couldn&#39;t tell what you want to protect yet.");
      expect(calls).toBe(2);
    } finally { signal.abort(); await expect(result).rejects.toThrow('local_plan_canceled'); }
  });

  it('rejects unrelated questions before calling the local model', async () => {
    let url = '';
    let calls = 0;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async () => { calls++; return { questions: [localPlanQuestions[1]], unassignedSources: [] }; } },
      create: async () => ({ id: 'unexpected' }), open: (value) => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    const page = await fetch(url);
    expect(page.headers.get('referrer-policy')).toBe('same-origin');
    const initial = await page.text();
    const empty = await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin,
      'Content-Type': 'application/x-www-form-urlencoded' }, body: form(initial, 'infer') });
    expect(empty.status).toBe(400);
    expect(await empty.text()).toContain('Enter a message or select a text file');
    expect(calls).toBe(0);
    const response = await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin,
      'Content-Type': 'application/x-www-form-urlencoded' }, body: form(initial, 'infer', '&message=What%20is%20the%20weather%3F') });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Describe the assets or provide labeled values for this plan.');
    expect(calls).toBe(0);
    const tooLong = await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin,
      'Content-Type': 'application/x-www-form-urlencoded' }, body: form(initial, 'infer', `&message=password%3A%20${'x'.repeat(4_001)}`) });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.text()).toContain('Input too long');
    expect(calls).toBe(0);
    const fileTooLong = await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin,
      'Content-Type': 'application/x-www-form-urlencoded' }, body: form(initial, 'infer', `&file=${'x'.repeat(8_001)}`) });
    expect(fileTooLong.status).toBe(400);
    expect(await fileTooLong.text()).toContain('Input too long');
    expect(calls).toBe(0);
    const fileTooLarge = await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin,
      'Content-Type': 'application/x-www-form-urlencoded' }, body: form(initial, 'infer', `&file=${encodeURIComponent('漢'.repeat(6_000))}`) });
    expect(fileTooLarge.status).toBe(400);
    expect(await fileTooLarge.text()).toContain('Text file too large');
    expect(calls).toBe(0);
    signal.abort();
    await expect(result).rejects.toThrow('local_plan_canceled');
  });
  it('rejects forged host and origin; creates only after explicit review', async () => {
    let calls = 0;
    const session = await start(async (input) => { calls++; expect(input.asset.secret[field]).toBe('secret'); return { id: 'created' }; });
    try {
      const html = await (await fetch(session.url)).text();
      expect(html).not.toContain('<code>secret</code>');
      expect(await new Promise<number>((resolve) => { const req = request(session.url, { headers: { Host: 'evil.test' } }, (res) => { res.resume(); resolve(res.statusCode!); }); req.end(); })).toBe(403);
      const payload = form(html, 'infer', '&message=use%20secret');
      expect((await fetch(session.url, { method: 'POST', headers: { Origin: 'http://evil.test', 'Content-Type': 'application/x-www-form-urlencoded' }, body: payload })).status).toBe(403);
      const reviewed = await (await fetch(session.url, { method: 'POST', headers: { Origin: new URL(session.url).origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: payload })).text();
      expect(reviewed).toContain('Show value');
      expect(reviewed).not.toContain('use secret');
      expect(calls).toBe(0);
      const created = await fetch(session.url, { method: 'POST', headers: { Origin: new URL(session.url).origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(reviewed, 'create', '&title=Safe%20plan&name=Account') });
      expect(created.status).toBe(200);
      await expect(session.result).resolves.toEqual({ id: 'created' });
      expect(calls).toBe(1);
    } finally { session.signal.abort(); }
  });
  it('shows the real creation status and escapes the plan ID without returning secret values', async () => {
    for (const status of ['READY', 'PENDING'] as const) {
      const session = await start(async () => ({ planId: '<plan&one>', status }));
      const headers = { Origin: new URL(session.url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
      const initial = await (await fetch(session.url)).text();
      const reviewed = await (await fetch(session.url, { method: 'POST', headers, body: form(initial, 'infer', '&message=use%20secret') })).text();
      const response = await fetch(session.url, { method: 'POST', headers, body: form(reviewed, 'create', '&title=Safe%20plan&name=Account') });
      const html = await response.text();
      expect(html).toContain(status === 'READY' ? 'Plan ready' : 'Plan pending');
      expect(html).toContain('Plan ID: &lt;plan&amp;one&gt;');
      expect(html).not.toContain('secret');
      expect(html).not.toContain('<plan&one>');
      await expect(session.result).resolves.toEqual({ planId: '<plan&one>', status });
    }
  });
  it('shows a generic completion when the creator has no recognized status', async () => {
    const session = await start(async () => ({ id: 'created', status: 'UNKNOWN' }));
    const headers = { Origin: new URL(session.url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    const initial = await (await fetch(session.url)).text();
    const reviewed = await (await fetch(session.url, { method: 'POST', headers, body: form(initial, 'infer', '&message=use%20secret') })).text();
    const response = await fetch(session.url, { method: 'POST', headers, body: form(reviewed, 'create', '&title=Safe%20plan&name=Account') });
    const html = await response.text();
    expect(html).toContain('Plan creation completed');
    expect(html).not.toContain('UNKNOWN');
    expect(html).not.toContain('Plan ID:');
    await expect(session.result).resolves.toEqual({ id: 'created', status: 'UNKNOWN' });
  });
  it('can replace a masked field value during explicit confirmation', async () => {
    let received = '';
    const session = await start(async (input) => { received = input.asset.secret[field]!; return { id: 'created' }; });
    const origin = new URL(session.url).origin;
    const html = await (await fetch(session.url)).text();
    const reviewed = await (await fetch(session.url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(html, 'infer', '&message=use%20secret') })).text();
    expect(reviewed).not.toContain('use secret');
    await fetch(session.url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(reviewed, 'create', `&title=Safe%20plan&name=Account&field%3A${encodeURIComponent(field)}=replacement`) });
    await expect(session.result).resolves.toEqual({ id: 'created' });
    expect(received).toBe('replacement');
  });
  it('keeps selected values collapsed and escapes them for deliberate reveal', async () => {
    let url = '';
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async ({ sources }) => {
      const source = sources.at(-1)!;
      return { title: 'Safe plan', asset: { type: asset.id, name: 'Account', fields: {
        [field]: { sourceId: source.id, start: 4, end: (source as { text: string }).text.length },
      } }, questions: [], unassignedSources: [] };
    } }, create: async () => ({ id: 'created' }), open: (value) => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    const html = await (await fetch(url)).text();
    expect(html).not.toContain('<&"secret');
    const reviewed = await (await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin,
      'Content-Type': 'application/x-www-form-urlencoded' }, body: form(html, 'infer', '&message=use%20%3C%26%22secret') })).text();
    expect(reviewed).toContain('Show value');
    expect(reviewed).toContain('data-field-panel="view" hidden>&lt;&amp;&quot;secret</code>');
    expect(reviewed).not.toContain('<code><&"secret</code>');
    expect(reviewed).not.toContain('<details open');
    signal.abort();
    await expect(result).rejects.toThrow('local_plan_canceled');
  });
  it('shows omitted details before creation without an extra checkbox', async () => {
    let url = '';
    let calls = 0;
    const result = runLocalPlanBrowser({ model: { infer: async ({ sources }) => {
      const source = sources.at(-1)!;
      return { title: 'Safe plan', asset: { type: asset.id, name: 'Account', fields: {
        [field]: { sourceId: source.id, start: 4, end: 10 },
      } }, questions: [localPlanQuestions[6]], unassignedSources: [source.id] };
    } }, create: async () => { calls++; return { id: 'created' }; }, open: (value) => { url = value; } });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    const html = await (await fetch(url)).text();
    const reviewed = await (await fetch(url, { method: 'POST', headers, body: form(html, 'infer', '&message=use%20secret') })).text();
    expect(reviewed).toContain(localPlanQuestions[6]);
    expect(reviewed).not.toContain('Not included:');
    expect(reviewed).toContain('Update the fields to include missing details.');
    expect(reviewed).not.toContain('omissionsConfirmed');
    const creation = form(reviewed, 'create', '&title=Safe%20plan&name=Account');
    expect((await fetch(url, { method: 'POST', headers, body: creation })).status).toBe(200);
    await expect(result).resolves.toEqual({ id: 'created' });
    expect(calls).toBe(1);
  });
  it('reviews and creates both detected assets in one plan', async () => {
    let url = '';
    let calls = 0;
    let created: { assets: { secret: Record<string, string> }[] } | undefined;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async ({ sources, allowedAssets, candidates }) => {
      calls++;
      if (candidates?.length) return { title: 'Keys', ...candidateMetadata(candidates), groups: candidates
        .filter(candidate => !/^(?:plan name|plan title|title|plan description|description|assets?|possible asset types|descripci[oó]n(?: del plan)?)$/iu.test(candidate.label))
        .map(candidate => ({ name: /api[_ -]?key/iu.test(candidate.label) ? 'Service' : 'Account', members: [{ id: candidate.id, role: /api[_ -]?key/iu.test(candidate.label) ? 'apiKey' : 'password' }] })) };
      expect(allowedAssets.some(({ id }) => id === 'API-KEY')).toBe(true);
      const source = sources[0]!;
      if (source.kind !== 'message') throw new Error('unexpected source');
      const start = source.text.indexOf('sample-key');
      const password = source.text.indexOf('example-123');
      return { title: 'Keys', assets: [
        { type: 'USER-PSWD', name: 'Account', fields: { password: { sourceId: source.id, start: password, end: password + 11 } } },
        { type: 'API-KEY', name: 'Service', fields: { apiKey: { sourceId: source.id, start, end: start + 10 } } },
      ], questions: [], unassignedSources: [] };
    } }, create: async (input) => { created = input; return { planId: 'plan', status: 'READY' }; }, open: (value) => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const initial = await (await fetch(url)).text();
      const input = encodeURIComponent('password: "example-123"\napiKey: "sample-key"');
      const reviewed = await (await fetch(url, { method: 'POST', headers, body: form(initial, 'infer', `&message=${input}`) })).text();
      expect(calls).toBe(1);
      expect(reviewed).toContain('Data · 2 assets');
      expect(reviewed).toContain('Show value');
      const submit = form(reviewed, 'create', '&title=Keys&name%3A0=Account&name%3A1=Service');
      expect((await fetch(url, { method: 'POST', headers, body: submit })).status).toBe(200);
      await expect(result).resolves.toEqual({ planId: 'plan', status: 'READY' });
      expect(created?.assets.map(({ secret }) => secret)).toEqual([{ password: 'example-123' }, { apiKey: 'sample-key' }]);
    } finally { signal.abort(); }
  });
  it('adds, suggests and removes assets in a model review while retaining original values', async () => {
    let url = '';
    let created: { title: string; description?: string; assets: { secret: Record<string, string> }[] } | undefined;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model, create: async (input) => { created = input; return { id: 'created' }; },
      open: value => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise(resolve => setTimeout(resolve, 1));
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const initial = await (await fetch(url)).text();
      const message = encodeURIComponent('Plan name: Explicit title. Description: Explicit purpose. Values: password: "secret"');
      const reviewed = await (await fetch(url, { method: 'POST', headers, body: form(initial, 'infer', `&message=${message}`) })).text();
      expect(reviewed).toContain('value="Explicit title"');
      expect(reviewed).toContain('Explicit purpose');
      expect(reviewed).toContain('data-add-review-asset');
      expect(reviewed).toContain('data-suggest-asset');
      expect(reviewed).toContain('data-remove-asset');
      expect(reviewed).not.toContain('Values are hidden until opened');
      expect(reviewed).not.toContain('1 / 2');
      expect(reviewed.indexOf('data-add-review-asset')).toBeLessThan(reviewed.indexOf('data-review-assets'));
      expect(reviewed).toContain('data-asset-dialog');
      expect(reviewed).toContain('data-close-asset-magic aria-label="Close"');
      expect(reviewed).not.toContain('data-close-asset-magic>Close</button>');
      expect(reviewed).not.toContain('Add a value');
      expect(reviewed).not.toContain('Enter value');
      expect(reviewed).not.toContain('<h4>Name</h4>');
      expect(reviewed).not.toContain('<h4>Metadata</h4>');
      expect(reviewed).toContain('<h4>Protected data</h4>');
      expect(reviewed).toContain('All fields in this section are encrypted.');
      expect(reviewed.indexOf('>Asset name</label>')).toBeLessThan(reviewed.indexOf('>Asset type</label>'));
      expect(reviewed.indexOf('>Asset type</label>')).toBeLessThan(reviewed.indexOf('<h4>Protected data</h4>'));
      const csrf = /name="csrf" value="([^"]+)"/.exec(reviewed)![1]!;
      const suggested = await fetch(url, { method: 'POST', headers, body: new URLSearchParams({ csrf, action: 'suggest-asset', assetType: 'PLAIN-TEXT', assetPrompt: 'NEW_VALUE=synthetic-value' }) });
      expect(suggested.status).toBe(200);
      const submit = form(reviewed, 'create', '&title=Explicit%20title&description=Explicit%20purpose&name=Original&additionalAssetCount=2&remove%3A1=1&type%3A2=PLAIN-TEXT&name%3A2=Added&field%3A2%3Atext=synthetic-value');
      expect((await fetch(url, { method: 'POST', headers, body: submit })).status).toBe(200);
      await expect(result).resolves.toEqual({ id: 'created' });
      expect(created?.title).toBe('Explicit title');
      expect(created?.description).toBe('Explicit purpose');
      expect(created?.assets.map((item) => item.secret)).toEqual([{ [field]: 'secret' }, { text: 'synthetic-value' }]);
    } finally { signal.abort(); }
  });
  it('can remove a suggested asset before creation', async () => {
    let url = '';
    let created: { assets: { secret: Record<string, string> }[] } | undefined;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async ({ sources, candidates }) => {
      if (candidates?.length) return { title: 'Review', groups: candidates.map((candidate, index) => ({ name: index ? 'Second' : 'First', members: [{ id: candidate.id, role: index ? 'apiKey' : 'unknown' }] })) };
      const source = sources[0]!;
      if (source.kind !== 'message') throw new Error('unexpected source');
      const first = source.text.indexOf('first-value');
      const second = source.text.indexOf('second-value');
      return { title: 'Review', assets: [
        { type: 'PLAIN-TEXT', name: 'First', fields: { text: { sourceId: source.id, start: first, end: first + 11 } } },
        { type: 'API-KEY', name: 'Second', fields: { apiKey: { sourceId: source.id, start: second, end: second + 12 } } },
      ], questions: [], unassignedSources: [] };
    } }, create: async (input) => { created = input; return { id: 'created' }; }, open: value => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise(resolve => setTimeout(resolve, 1));
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const initial = await (await fetch(url)).text();
      const reviewed = await (await fetch(url, { method: 'POST', headers, body: form(initial, 'infer', '&message=first-value%20second-value') })).text();
      const submit = form(reviewed, 'create', '&title=Review&remove%3A0=1&name%3A1=Second');
      expect((await fetch(url, { method: 'POST', headers, body: submit })).status).toBe(200);
      await expect(result).resolves.toEqual({ id: 'created' });
      expect(created?.assets.map((item) => item.secret)).toEqual([{ apiKey: 'second-value' }]);
    } finally { signal.abort(); }
  });
  it('lets review change asset type and fill an unassigned field without reusing the old reference', async () => {
    const first = quickPlanAssetCatalog.find(({ id }) => id === 'USER-PSWD')!;
    const second = quickPlanAssetCatalog.find(({ id }) => id === 'PLAIN-TEXT')!;
    let url = '';
    let created: { title: string; asset: { type: string; secret: Record<string, string> } } | undefined;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async ({ sources, allowedAssets, candidates }) => {
      if (allowedAssets.length === 1 && allowedAssets[0]?.id === second.id)
        return { questions: [localPlanQuestions[3]], unassignedSources: [sources[0]!.id] };
      if (candidates?.length) return { title: 'Existing plan', ...candidateMetadata(candidates), groups: [{ name: 'Existing asset', members: [{ id: candidates.find(candidate => /password/iu.test(candidate.label))!.id, role: 'password' }] }] };
      const source = sources[0]!;
      if (source.kind !== 'message') throw new Error('unexpected source');
      const start = source.text.indexOf('synthetic-old');
      return { title: 'Existing plan', asset: { type: first.id, name: 'Existing asset', fields: { password: { sourceId: source.id, start, end: start + 13 } } }, questions: [], unassignedSources: [] };
    } }, create: async (input) => { created = input as typeof created; return { id: 'created' }; }, open: (value) => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const initial = await (await fetch(url)).text();
      const reviewed = await (await fetch(url, { method: 'POST', headers, body: form(initial, 'infer', '&message=password%3A%20%22synthetic-old%22') })).text();
      const changed = await (await fetch(url, { method: 'POST', headers, body: form(reviewed, 'choose', '&assetType=PLAIN-TEXT') })).text();
      expect(changed).not.toContain('synthetic-old</code>');
      expect(changed).toContain('Existing plan');
      const submit = form(changed, 'create', '&title=Existing%20plan&name=Existing%20asset&field%3Atext=synthetic-new');
      expect((await fetch(url, { method: 'POST', headers, body: submit })).status).toBe(200);
      await expect(result).resolves.toEqual({ id: 'created' });
      expect(created?.asset.type).toBe('PLAIN-TEXT');
      expect(created?.asset.secret).toEqual({ text: 'synthetic-new' });
    } finally { signal.abort(); }
  });
  it('suggests separate plain-text assets for distinct unmapped file entries', async () => {
    let url = '';
    let calls = 0;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async () => { calls++; return { questions: [localPlanQuestions[2]], unassignedSources: [] }; } },
      create: async () => ({ id: 'unexpected' }), open: (value) => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    try {
      const initial = await (await fetch(url)).text();
      const body = new FormData();
      body.set('csrf', /name="csrf" value="([^"]+)"/.exec(initial)![1]!);
      body.set('action', 'infer');
      body.set('file', new Blob(['API_KEY=sample-key\nPRIVATE_KEY=sample-private-key'], { type: 'text/plain' }), 'credentials.env');
      const choicePage = await (await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin }, body })).text();
      expect(choicePage).toContain('Data · 2 assets');
      expect(choicePage).toContain('Api Key');
      expect(choicePage).toContain('Private Key');
      expect(calls).toBe(1);
    } finally { signal.abort(); await expect(result).rejects.toThrow('local_plan_canceled'); }
  });
  it('reviews a pasted credentials bundle as separate plain-text assets', async () => {
    let created: { assets?: { secret: Record<string, string> }[] } | undefined;
    const session = await start(async (input) => {
      created = input as typeof created;
      return { id: 'created' };
    });
    try {
      const initial = await (await fetch(session.url)).text();
      const bundle = '# Database\nDATABASE_PASSWORD=synthetic-db-password\n\n# AWS\nAWS_SECRET_ACCESS_KEY=synthetic-aws-secret';
      const reviewed = await (await fetch(session.url, { method: 'POST', headers: { Origin: new URL(session.url).origin,
        'Content-Type': 'application/x-www-form-urlencoded' }, body: form(initial, 'infer', `&message=${encodeURIComponent(bundle)}`) })).text();
      expect(reviewed).toContain('Data · 2 assets');
      expect(reviewed).not.toContain('Which asset field should contain');
      expect(reviewed).toContain('Show value');
      await fetch(session.url, { method: 'POST', headers: { Origin: new URL(session.url).origin,
        'Content-Type': 'application/x-www-form-urlencoded' }, body: form(reviewed, 'create', '&title=Recovery&name%3A0=Database&name%3A1=AWS') });
      await expect(session.result).resolves.toEqual({ id: 'created' });
      expect(created?.assets?.map((asset) => asset.secret.text)).toHaveLength(2);
    } finally { session.signal.abort(); }
  });
  it('reviews OAuth entries separately when the model cannot map them', async () => {
    let url = '';
    let calls = 0;
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async () => { calls++; return { questions: [localPlanQuestions[2]], unassignedSources: [] }; } },
      create: async () => ({ id: 'unexpected' }), open: (value) => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    try {
      const initial = await (await fetch(url)).text();
      const message = 'Microsft oauth credetials: These are the credentials for oAuth for inheriti app\n\nMICROSOFT_OAUTH_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\nMICROSOFT_OAUTH_CLIENT_SECRET=synthetic-client-secret .';
      const reviewed = await (await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin,
        'Content-Type': 'application/x-www-form-urlencoded' }, body: form(initial, 'infer', `&message=${encodeURIComponent(message)}`) })).text();
      expect(reviewed).toContain('Data · 2 assets');
      expect(reviewed).not.toContain(localPlanQuestions[2]);
      expect(calls).toBe(1);
    } finally { signal.abort(); await expect(result).rejects.toThrow('local_plan_canceled'); }
  });
  it('uses the plan name from the message with a multi-service env file', async () => {
    const session = await start();
    try {
      const initial = await (await fetch(session.url)).text();
      const body = new FormData();
      body.set('csrf', /name="csrf" value="([^"]+)"/.exec(initial)![1]!);
      body.set('action', 'infer');
      body.set('message', 'Create a plan called "Infrastructure recovery".');
      body.set('file', new Blob(['# Database\nDATABASE_PASSWORD=synthetic-db-password\n# AWS\nAWS_SECRET_ACCESS_KEY=synthetic-aws-secret'], { type: 'text/plain' }), 'credentials.env');
      const reviewed = await (await fetch(session.url, { method: 'POST', headers: { Origin: new URL(session.url).origin }, body })).text();
      expect(reviewed).toContain('Data · 2 assets');
      expect(reviewed).toContain('value="Infrastructure recovery"');
      expect(reviewed).not.toContain('Which asset field should contain');
    } finally { session.signal.abort(); await expect(session.result).rejects.toThrow('local_plan_canceled'); }
  });
  it('cancels without creation', async () => {
    let calls = 0;
    const session = await start(async () => { calls++; return { id: 'created' }; });
    const html = await (await fetch(session.url)).text();
    await fetch(session.url, { method: 'POST', headers: { Origin: new URL(session.url).origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(html, 'cancel') });
    await expect(session.result).rejects.toThrow('local_plan_canceled');
    expect(calls).toBe(0);
  });
  it('rejects concurrent inference but permits cancellation during it', async () => {
    let url = '';
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const result = runLocalPlanBrowser({ model: { infer: async () => { started(); return new Promise(() => {}); } },
      create: async () => ({ id: 'unexpected' }), open: (value) => { url = value; } });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    const html = await (await fetch(url)).text();
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    const pending = fetch(url, { method: 'POST', headers, body: form(html, 'infer', '&message=use%20secret') }).catch(() => undefined);
    await entered;
    expect((await fetch(url, { method: 'POST', headers: { Origin: new URL(url).origin, 'Content-Type': 'text/plain' }, body: 'malformed' })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers, body: form(html, 'infer', '&message=second') })).status).toBe(409);
    expect((await fetch(url, { method: 'POST', headers, body: form(html, 'cancel') })).status).toBe(200);
    await expect(result).rejects.toThrow('local_plan_canceled');
    await pending;
  });
  it('waits for an in-flight creation after cancellation or expiry', async () => {
    let complete!: (value: { id: string }) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const session = await start(async () => { started(); return new Promise((resolve) => { complete = resolve; }); });
    const origin = new URL(session.url).origin;
    const headers = { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    const html = await (await fetch(session.url)).text();
    const reviewed = await (await fetch(session.url, { method: 'POST', headers, body: form(html, 'infer', '&message=use%20secret') })).text();
    const committing = fetch(session.url, { method: 'POST', headers, body: form(reviewed, 'create', '&title=Safe%20plan&name=Account') });
    await entered;
    expect((await fetch(session.url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: 'malformed' })).status).toBe(400);
    session.signal.abort();
    expect((await fetch(session.url, { method: 'POST', headers, body: form(reviewed, 'cancel') })).status).toBe(409);
    complete({ id: 'created' });
    expect((await committing).status).toBe(200);
    await expect(session.result).resolves.toEqual({ id: 'created' });
  });
  it('keeps reviewed input for a safe retry after creation fails', async () => {
    const inputs: string[] = [];
    const session = await start(async (input) => {
      inputs.push(input.asset.secret[field]!);
      if (inputs.length === 1) throw new Error('secret must stay hidden');
      return { id: 'created' };
    });
    const headers = { Origin: new URL(session.url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    const html = await (await fetch(session.url)).text();
    const reviewed = await (await fetch(session.url, { method: 'POST', headers, body: form(html, 'infer', '&message=use%20secret') })).text();
    const body = form(reviewed, 'create', `&title=Safe%20plan&name=Account&field%3A${encodeURIComponent(field)}=corrected`);
    const failed = await fetch(session.url, { method: 'POST', headers, body });
    expect(failed.status).toBe(500);
    const retryPage = await failed.text();
    expect(retryPage).toContain('Review and retry');
    expect(retryPage).not.toContain('secret must stay hidden');
    expect(retryPage).not.toContain('use secret');
    expect((await fetch(session.url, { method: 'POST', headers, body: form(retryPage, 'create', '&title=Safe%20plan&name=Account') })).status).toBe(200);
    await expect(session.result).resolves.toEqual({ id: 'created' });
    expect(inputs).toEqual(['corrected', 'corrected']);
  });
  it('keeps failed or oversized input out of later inference', async () => {
    let url = '';
    let fail = true;
    const observed: number[] = [];
    const signal = new AbortController();
    const result = runLocalPlanBrowser({ model: { infer: async ({ sources }) => {
      observed.push(sources.length);
      if (fail) throw new Error('failed');
      return model.infer({ sources });
    } }, create: async () => ({ id: 'created' }), open: (value) => { url = value; }, signal: signal.signal });
    void result.catch(() => {});
    while (!url) await new Promise((resolve) => setTimeout(resolve, 1));
    const html = await (await fetch(url)).text();
    const headers = { Origin: new URL(url).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    expect((await fetch(url, { method: 'POST', headers, body: form(html, 'infer', `&message=${'x'.repeat(1_100_000)}`) })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers, body: form(html, 'infer', '&message=first%20secret') })).status).toBe(400);
    fail = false;
    const reviewed = await (await fetch(url, { method: 'POST', headers, body: form(html, 'infer', '&message=use%20secret') })).text();
    expect(reviewed).toContain('Review plan');
    expect(observed).toEqual([1, 1]);
    signal.abort();
    await expect(result).rejects.toThrow('local_plan_canceled');
  });
});
