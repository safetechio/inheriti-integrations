import { afterEach, expect, it, vi } from 'vitest';

const child = vi.hoisted(() => ({ once: vi.fn(), kill: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => child) }));
vi.mock('node:net', () => ({ createServer: () => ({ once: vi.fn(), listen: (_port: number, _host: string, callback: () => void) => callback(), address: () => ({ port: 12345 }), close: vi.fn() }) }));
const httpCalls = vi.hoisted(() => vi.fn());
vi.mock('node:http', async () => {
  const { EventEmitter } = await import('node:events');
  return { request: (options: { path: string; socketPath: string }, callback: (response: any) => void) => {
    const req = Object.assign(new EventEmitter(), { end: vi.fn((body?: string) => { const fail = httpCalls(options, body); queueMicrotask(() => {
      const res = Object.assign(new EventEmitter(), { statusCode: fail ? 500 : 200 });
      callback(res);
      const suggestion = { title: 'Plan', asset: { type: 'x', name: 'Account', fields: { password: { sourceId: 'one', key: 'PASSWORD' } } }, questions: [], unassignedSources: [] };
      const body = options.path === '/health' ? '{}' : JSON.stringify({ choices: [{ message: { content: JSON.stringify(suggestion) } }] });
      res.emit('data', Buffer.from(body)); res.emit('end');
    }); }), destroy: vi.fn() });
    return req;
  } };
});
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { LlamaPlanModel } from '../src/llama-plan-model.js';
import { quickPlanAssetCatalog } from '../src/quick-plan.js';
import { LocalPlanCandidateDetector } from '../src/local-plan-candidates.js';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('assigns separate stable IDs to identical values at different positions', () => {
  const text = 'PASSWORD=repeat-secret\nTOKEN=repeat-secret';
  const { candidates, modelSources } = new LocalPlanCandidateDetector().detect([{ id: 'source', kind: 'message', text }]);
  expect(candidates.map(({ id }) => id)).toEqual(['v0', 'v1']);
  expect(candidates.map(({ valueReference }) => valueReference)).toEqual([
    { sourceId: 'source', start: text.indexOf('repeat-secret'), end: text.indexOf('repeat-secret') + 13 },
    { sourceId: 'source', start: text.lastIndexOf('repeat-secret'), end: text.lastIndexOf('repeat-secret') + 13 },
  ]);
  expect(JSON.stringify(modelSources)).not.toContain('repeat-secret');
});

it('retains prose while masking an explicit plan title and candidate values', () => {
  const text = 'Plan title: Shared Accounts\nProtect these GitHub credentials: password: "private-secret"';
  const { candidates, modelSources } = new LocalPlanCandidateDetector().detect([{ id: 'message', kind: 'message', text }]);
  expect(candidates[0]!.label).toBe('Plan title');
  expect(modelSources[0]).toMatchObject({ kind: 'message', text: expect.stringContaining('Plan title: [v0]') });
  expect(JSON.stringify(modelSources)).toContain('GitHub credentials');
  expect(JSON.stringify(modelSources)).toContain('[v1]');
  expect(JSON.stringify(modelSources)).not.toContain('Shared Accounts');
  expect(JSON.stringify(modelSources)).not.toContain('private-secret');
});

it('detects multilingual colon values and URLs with exact offsets', () => {
  const text = 'Plan title: Access\nServicio: Portal\nUsuario: alice\nContraseña: synthetic-pass\nURL de acceso: https://example.test/login';
  const { candidates, modelSources } = new LocalPlanCandidateDetector().detect([{ id: 'message', kind: 'message', text }]);
  expect(candidates.map(({ id, label }) => [id, label])).toEqual([
    ['v0', 'Plan title'], ['v1', 'Servicio'], ['v2', 'Usuario'], ['v3', 'Contraseña'], ['v4', 'URL de acceso'],
  ]);
  for (const [index, value] of ['Access', 'Portal', 'alice', 'synthetic-pass', 'https://example.test/login'].entries()) {
    const start = text.indexOf(value);
    expect(candidates[index]!.valueReference).toEqual({ sourceId: 'message', start, end: start + value.length });
    expect(JSON.stringify(modelSources)).not.toContain(value);
  }
  expect(JSON.stringify(modelSources)).toContain('Plan title: [v0]');
  expect(JSON.stringify(modelSources)).toContain('URL de acceso: [v4]');
});

it('masks structured values in prose and retains their exact source spans', () => {
  const values = ['ads@example.test', 'https://example.test/login', 'prose-sample-123', '192.0.2.7', 'mailto:team@example.test'];
  const text = `Reach ${values[0]} through ${values[1]} with password "${values[2]}" from ${values[3]}; alternate ${values[4]}`;
  const { candidates, modelSources } = new LocalPlanCandidateDetector().detect([{ id: 'message', kind: 'message', text }]);
  expect(candidates.filter(({ label }) => label === 'email')).toHaveLength(1);
  expect(candidates.filter(({ label }) => label === 'url')).toHaveLength(2);
  for (const value of values) {
    const start = text.indexOf(value);
    expect(candidates.some(({ valueReference }) => 'start' in valueReference && valueReference.start === start && valueReference.end === start + value.length), `${value}: ${JSON.stringify(candidates)}`).toBe(true);
    expect(JSON.stringify(modelSources)).not.toContain(value);
  }
});

it('keeps separate quoted values after a prose colon and masks an unclosed quoted field', () => {
  const inputs = [
    { text: 'Protect these values: first "sample-one-123", second "sample-two-456"', values: ['sample-one-123', 'sample-two-456'] },
    { text: 'Password: "unterminated sample-123', values: ['unterminated sample-123'] },
  ];
  for (const { text, values } of inputs) {
    const { candidates, modelSources } = new LocalPlanCandidateDetector().detect([{ id: 'message', kind: 'message', text }]);
    expect(candidates).toHaveLength(values.length);
    for (const value of values) {
      const start = text.indexOf(value);
      expect(candidates.some(({ valueReference }) => 'start' in valueReference && valueReference.start === start && valueReference.end === start + value.length)).toBe(true);
      expect(JSON.stringify(modelSources)).not.toContain(value);
    }
  }
});

it('keeps the full labeled token when structured syntax is only part of its value', () => {
  for (const value of ['foo@example.test!', 'https://example.test/token!']) {
    const text = `PASSWORD=${value}`;
    const { candidates, modelSources } = new LocalPlanCandidateDetector().detect([{ id: 'message', kind: 'message', text }]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.valueReference).toEqual({ sourceId: 'message', start: 9, end: text.length });
    expect(JSON.stringify(modelSources)).not.toContain(value);
  }
});

it('masks parsed fields and quoted values and sends only candidate IDs to the model', async () => {
  const batch = new LocalPlanCandidateDetector().detect([
    { id: 'env', kind: 'fields', fields: { PASSWORD: 'field-secret' } },
    { id: 'message', kind: 'message', text: 'Wachtwoord: "quoted-secret"' },
  ]);
  expect(batch.candidates.map(({ id }) => id)).toEqual(['v0', 'v1']);
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  await model.infer({ sources: batch.modelSources, allowedAssets: quickPlanAssetCatalog, currentDraft: null,
    candidates: batch.candidates.map(({ id, label }) => ({ id, label })) }, new AbortController().signal);
  const request = JSON.parse(httpCalls.mock.calls[1]![1]);
  expect(JSON.stringify(request)).not.toMatch(/field-secret|quoted-secret/);
  expect(request.max_tokens).toBe(136);
  expect(request.response_format.schema.required).toEqual(['assignments']);
  const assignments = request.response_format.schema.properties.assignments;
  expect(assignments.minItems).toBe(2);
  expect(assignments.maxItems).toBe(2);
  expect(Object.keys(assignments.items.properties)).toEqual(['group', 'role']);
  expect(assignments.items.properties.role.enum).toContain('unknown');
  expect(assignments.items.properties.role.enum).toContain('secretAccessKey');
  expect(request.messages[0].content).toContain('candidate');
});

it('preserves stable candidate IDs in an already masked model request', async () => {
  const batch = new LocalPlanCandidateDetector().detect([{ id: 'message', kind: 'message', text: 'My login is ads@example.test\npassword: summer' }]);
  expect(batch.candidates.map(({ id }) => id)).toEqual(['v0', 'v1']);
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  await model.infer({ sources: batch.modelSources, allowedAssets: quickPlanAssetCatalog, currentDraft: null,
    candidates: batch.candidates.map(({ id, label }) => ({ id, label })) }, new AbortController().signal);
  const prompt = JSON.parse(httpCalls.mock.calls[1]![1]).messages[1].content as string;
  expect(prompt).toContain('[v0]');
  expect(prompt).toContain('[v1]');
  expect(prompt).not.toMatch(/ads@example\.test|summer/);
});

it('rejects candidate requests without their masked source markers before starting the model', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  await expect(model.infer({ sources: [{ id: 'message', kind: 'message', text: 'password: example-secret' }],
    allowedAssets: quickPlanAssetCatalog, currentDraft: null, candidates: [{ id: 'v0', label: 'password' }] },
  new AbortController().signal)).rejects.toThrow('Invalid candidate input');
  expect(spawn).not.toHaveBeenCalled();
});

it('keeps source values off argv and uses a private socket', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const result = await model.infer({ sources: [{ id: 'one', kind: 'fields', fields: { PASSWORD: 'secret-value' } }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  expect(result).toMatchObject({ title: 'Plan', asset: { fields: { password: { key: 'PASSWORD' } } } });
  expect(JSON.stringify(result)).not.toContain('secret-value');
  expect(JSON.stringify(vi.mocked(spawn).mock.calls[0])).not.toContain('secret-value');
  expect(httpCalls.mock.calls[1]![0].socketPath).toMatch(/model\.sock$/);
  expect(httpCalls.mock.calls[0]![0].headers.authorization).toMatch(/^Bearer /);
  expect(httpCalls.mock.calls[1]![1]).not.toContain('secret-value');
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  expect(schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields.properties.password.oneOf).toEqual([{ type: 'object', additionalProperties: false, required: ['sourceId', 'key'], properties: { sourceId: { const: 'one' }, key: { const: 'PASSWORD' } } }]);
  expect(schema.oneOf[0].properties.unassignedSources.items.enum).toEqual(['one']);
  expect(fetchMock).not.toHaveBeenCalled();
  model.stop();
  expect(child.kill).toHaveBeenCalledOnce();
});

it('masks source values in selected and entry classification prompts while retaining original schema offsets', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const text = 'Account: ads@example.test\nURL: https://example.test/login';
  await model.infer({ sources: [{ id: 'message', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog,
    currentDraft: null, entryLabels: ['Account', 'URL'] }, new AbortController().signal);
  const request = JSON.parse(httpCalls.mock.calls[1]![1]);
  expect(request.messages[1].content).not.toMatch(/ads@example\.test|https:\/\/example\.test\/login/);
  expect(request.response_format.schema.properties.entryTypes.minItems).toBe(2);
});

it('reuses one server for successful inferences and removes its private directory on stop', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const request = { sources: [{ id: 'one', kind: 'message' as const, text: 'password: synthetic' }], allowedAssets: quickPlanAssetCatalog, currentDraft: null };
  await model.infer(request, new AbortController().signal);
  await model.infer(request, new AbortController().signal);
  expect(spawn).toHaveBeenCalledOnce();
  expect(child.kill).not.toHaveBeenCalled();
  const socketPath = httpCalls.mock.calls[0]![0].socketPath as string;
  model.stop();
  expect(child.kill).toHaveBeenCalledOnce();
  await vi.waitFor(async () => { await expect(access(socketPath.replace(/\/model\.sock$/, ''))).rejects.toThrow(); });
});

it('rejects concurrent requests before starting another server', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const request = { sources: [{ id: 'one', kind: 'message' as const, text: 'password: synthetic' }], allowedAssets: quickPlanAssetCatalog, currentDraft: null };
  const first = model.infer(request, new AbortController().signal);
  await expect(model.infer(request, new AbortController().signal)).rejects.toThrow('Local model busy');
  await first;
  expect(spawn).toHaveBeenCalledOnce();
  model.stop();
});

it('stop aborts an active inference even if the child emits no exit event', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const request = { sources: [{ id: 'one', kind: 'message' as const, text: 'password: synthetic' }], allowedAssets: quickPlanAssetCatalog, currentDraft: null };
  httpCalls.mockImplementation(() => true);
  const inference = model.infer(request, new AbortController().signal);
  const rejected = expect(inference).rejects.toThrow('Local model unavailable');
  await vi.waitFor(() => expect(httpCalls).toHaveBeenCalled());
  model.stop();
  await rejected;
  expect(child.kill).toHaveBeenCalled();
});

it('stops after a failed request and can start again', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const request = { sources: [{ id: 'one', kind: 'message' as const, text: 'password: synthetic' }], allowedAssets: quickPlanAssetCatalog, currentDraft: null };
  httpCalls.mockImplementationOnce(() => false).mockImplementationOnce(() => true);
  await expect(model.infer(request, new AbortController().signal)).rejects.toThrow('Local model unavailable');
  expect(child.kill).toHaveBeenCalledOnce();
  await model.infer(request, new AbortController().signal);
  expect(spawn).toHaveBeenCalledTimes(2);
  model.stop();
});

it('rejects oversized input before spawning', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  await expect(model.infer({ sources: [{ id: 'one', kind: 'message', text: 'x'.repeat(65_000) }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal)).rejects.toThrow('too large');
  expect(spawn).not.toHaveBeenCalled();
});

it('constrains an explicit message value to its exact span', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const text = 'The password is synthetic-example-123';
  await model.infer({ sources: [{ id: 'sample', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  const password = schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields.properties.password.oneOf[0].properties;
  const start = text.indexOf('synthetic-example-123');
  expect(password).toEqual({ sourceId: { const: 'sample' }, start: { const: start }, end: { const: start + 'synthetic-example-123'.length } });
});

it('offers multiple distinct references for repeated asset fields', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const text = 'apiKey: "first-key"\napiKey: "second-key"';
  await model.infer({ sources: [{ id: 'sample', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  const multiple = schema.oneOf[1];
  expect(multiple.properties.assets.minItems).toBe(2);
  const api = multiple.properties.assets.items.oneOf.find((item: any) => item.properties.type.const === 'API-KEY');
  expect(api.properties.fields.properties.apiKey.oneOf).toHaveLength(2);
  expect(JSON.stringify(schema)).not.toContain('first-key');
});

it('offers a separate plain-text reference for each assignment without exposing its value in the schema', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const text = 'Plan title: Operations\nNODE_ENV=production\nPORT=3000\nCUSTOM_SECRET=synthetic-value';
  await model.infer({ sources: [{ id: 'sample', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  const plain = schema.oneOf[1].properties.assets.items.oneOf.find((item: any) => item.properties.type.const === 'PLAIN-TEXT');
  expect(plain.properties.fields.properties.text.oneOf).toHaveLength(3);
  expect(schema.oneOf[1].properties.assets.maxItems).toBeGreaterThanOrEqual(9);
  expect(JSON.stringify(schema)).not.toContain('synthetic-value');
});

it('uses a compact classification schema when entry labels are supplied', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  await model.infer({ sources: [{ id: 'sample', kind: 'message', text: 'A=synthetic-one\nB=synthetic-two' }],
    allowedAssets: quickPlanAssetCatalog, currentDraft: null, entryLabels: ['A', 'B'] }, new AbortController().signal);
  const request = JSON.parse(httpCalls.mock.calls[1]![1]);
  expect(request.response_format.schema.properties.entryTypes.minItems).toBe(2);
  expect(request.response_format.schema.required).toContain('title');
  expect(request.response_format.schema.required).toContain('useEntries');
  expect(request.response_format.schema.properties.entryTypes.maxItems).toBe(2);
  expect(request.messages[0].content).toContain('Each entry needs its own choice');
  expect(JSON.stringify(request.response_format.schema)).not.toContain('synthetic-one');
});

it('recognizes a quoted Spanish password without changing its source value', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const text = 'La contraseña es "valor-sintetico-456".';
  await model.infer({ sources: [{ id: 'spanish', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  const password = schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields.properties.password.oneOf[0].properties;
  const start = text.indexOf('valor-sintetico-456');
  expect(password).toEqual({ sourceId: { const: 'spanish' }, start: { const: start }, end: { const: start + 'valor-sintetico-456'.length } });
});

it('offers exact quoted spans for unknown language labels', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const text = 'Wachtwoord: "waarde,met;tekens"';
  await model.infer({ sources: [{ id: 'dutch', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  const password = schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields.properties.password.oneOf[0].properties;
  expect(schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields.maxProperties).toBe(1);
  const start = text.indexOf('waarde,met;tekens');
  expect(password).toEqual({ sourceId: { const: 'dutch' }, start: { const: start }, end: { const: start + 'waarde,met;tekens'.length } });
  expect(JSON.stringify(schema)).not.toContain('waarde,met;tekens');
});

it('offers the exact unlabeled value span in a natural request', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  const text = 'Hey create a plan called "GitHub login" for my password, this is the value "synthetic-123"';
  await model.infer({ sources: [{ id: 'message', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  const fields = schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields;
  const start = text.indexOf('synthetic-123');
  expect(fields.properties.password.oneOf[0].properties).toEqual({ sourceId: { const: 'message' }, start: { const: start }, end: { const: start + 'synthetic-123'.length } });
  expect(JSON.stringify(schema)).not.toContain('synthetic-123');
});

it('uses a later precise field label instead of an earlier generic quote', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  await model.infer({ sources: [
    { id: 'dutch', kind: 'message', text: 'Wachtwoord: "synthetic-value"' },
    { id: 'follow-up', kind: 'message', text: 'password: "synthetic-value"' },
  ], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  const fields = schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields;
  expect(Object.keys(fields.properties)).toEqual(['password']);
  expect(fields.properties.password.oneOf[0].properties.sourceId.const).toBe('follow-up');
});


it('preserves punctuation and quoted multiword password values', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  for (const [text, value] of [['password is hunter2!', 'hunter2!'], ['password is "two secret words"', 'two secret words'], ['password: "abc,def;ghi"', 'abc,def;ghi']] as const) {
    httpCalls.mockClear();
    await model.infer({ sources: [{ id: 'sample', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
    const fields = JSON.parse(httpCalls.mock.lastCall![1]).response_format.schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields;
    const ref = fields.properties.password.oneOf[0].properties;
    const start = text.indexOf(value);
    expect(ref).toEqual({ sourceId: { const: 'sample' }, start: { const: start }, end: { const: start + value.length } });
    expect(fields.additionalProperties).toBe(false);
    expect(Object.keys(fields.properties)).toEqual(['password']);
  }
});

it('keeps parsed file refs and other fields available beside a labeled message', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  await model.infer({ sources: [
    { id: 'chat', kind: 'message', text: 'username is alice' },
    { id: 'env', kind: 'fields', fields: { PASSWORD: 'hunter2!' } },
  ], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const fields = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields;
  expect(fields.properties.password.oneOf).toContainEqual({ type: 'object', additionalProperties: false, required: ['sourceId', 'key'], properties: { sourceId: { const: 'env' }, key: { const: 'PASSWORD' } } });
  if (fields.properties.username) expect(fields.properties.username.oneOf).toContainEqual({ type: 'object', additionalProperties: false, required: ['sourceId', 'start', 'end'], properties: { sourceId: { const: 'chat' }, start: { const: 12 }, end: { const: 17 } } });
});


it('asks for clarification when an unquoted value meets a sentence-final period', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  await model.infer({ sources: [{ id: 'sample', kind: 'message', text: 'The password is synthetic-example-123.' }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  expect(schema.oneOf).toHaveLength(1);
  expect(schema.oneOf[0].properties.questions.minItems).toBe(1);
});

it('does not bind truncated unquoted values with delimiters or following prose', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  for (const text of ['password: abc,def', 'password: abc;def', 'password: abc more words', 'password: abc\u00a0def']) {
    httpCalls.mockClear();
    await model.infer({ sources: [{ id: 'sample', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
    const schema = JSON.parse(httpCalls.mock.lastCall![1]).response_format.schema;
    expect(schema.oneOf).toHaveLength(1);
    expect(schema.oneOf[0].properties.questions.minItems).toBe(1);
  }
});

it('does not bind an escaped quote as a truncated secret', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  for (const text of ['password: "ab\\"cd"', 'contraseña: "ab\\"cd"']) {
    httpCalls.mockClear();
    await model.infer({ sources: [{ id: 'sample', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
    const schema = JSON.parse(httpCalls.mock.lastCall![1]).response_format.schema;
    expect(schema.oneOf).toHaveLength(1);
  }
});

it('rejects empty, unclosed, or suffixed quoted values', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  for (const text of ['password: ""', 'password: "actual-secret', 'password: "actual"suffix']) {
    httpCalls.mockClear();
    await model.infer({ sources: [{ id: 'sample', kind: 'message', text }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
    const schema = JSON.parse(httpCalls.mock.lastCall![1]).response_format.schema;
    expect(schema.oneOf).toHaveLength(1);
  }
});

it('keeps multiple known fields when an unknown quoted label is also present', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  await model.infer({ sources: [{ id: 'sample', kind: 'message', text: 'username: "alice"\npassword: "example-secret"\nwachtwoord: "unused"' }], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  const fields = schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields;
  expect(fields.maxProperties).toBeUndefined();
  expect(Object.keys(fields.properties)).toEqual(['username', 'password']);
});

it('keeps multiple file fields when a message has an unknown quoted label', async () => {
  const model = new LlamaPlanModel('/local/llama-server', '/local/model.gguf');
  await model.infer({ sources: [
    { id: 'message', kind: 'message', text: 'wachtwoord: "unused"' },
    { id: 'env', kind: 'fields', fields: { USERNAME: 'alice', PASSWORD: 'example-secret' } },
  ], allowedAssets: quickPlanAssetCatalog, currentDraft: null }, new AbortController().signal);
  const schema = JSON.parse(httpCalls.mock.calls[1]![1]).response_format.schema;
  const fields = schema.oneOf[0].properties.asset.oneOf.find((item: any) => item.properties.type.const === 'USER-PSWD').properties.fields;
  expect(fields.maxProperties).toBeUndefined();
  expect(Object.keys(fields.properties)).toEqual(['username', 'password']);
});
