import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import type { Socket } from 'node:net';
import type { QuickPlanInput } from '@safetech/inheriti-client-sdk/node';
import { renderLocalPlanCanceledPage, renderLocalPlanPage, renderLocalPlanResultPage } from './local-plan-page.js';
import { LocalPlanAssistant, localPlanSuggestionTimeoutMs } from './local-plan-assistant.js';
import { LocalPlanDraftValue } from './local-plan-draft.js';
import { LocalPlanSource, LocalPlanSources, localPlanInputLimits } from './local-plan-source.js';
import { quickPlanAssetCatalog } from './quick-plan.js';
import { localPlanAssetLimit } from './asset-metadata.js';
import type { LocalPlanClarification, LocalPlanDraft, LocalPlanHints, LocalPlanModel, LocalSource } from './local-plan-assistant.js';

const limit = 100_000;

type BrowserOptions<T> = {
  model: LocalPlanModel;
  create: (input: { title: string; description?: string; asset: QuickPlanInput['asset']; assets: [QuickPlanInput['asset'], ...QuickPlanInput['asset'][]]; teamId?: string }) => Promise<T>;
  open: (url: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  context?: string;
  teams?: readonly { id: string; name: string }[];
  fontFile?: URL;
  hints?: LocalPlanHints;
};

type BrowserState<T> = {
  assistant: LocalPlanAssistant;
  path: string;
  csrf: string;
  scriptNonce: string;
  port: number;
  sources: LocalSource[];
  draft: LocalPlanDraft | null;
  reviewAsset: { type: string; title: string; name: string; fields: readonly string[] } | null;
  clarification: LocalPlanClarification | null;
  selectedTeamId: string;
  selectedAssetType: string;
  hints: { title: string; description: string; assetTypes: string[] };
  busy: boolean;
  creating: boolean;
  interruptedDuringCreate: boolean;
  done: boolean;
  inference: AbortController;
  finish: (value?: T, error?: Error) => void;
};

/** The returned value comes from create; source text and the capability URL remain in this process. */
export async function runLocalPlanBrowser<T>(options: BrowserOptions<T>): Promise<T> {
  if (options.signal?.aborted) throw new Error('local_plan_canceled');
  const hints = { title: options.hints?.title?.trim() ?? '', description: options.hints?.description?.trim() ?? '', assetTypes: [...new Set(options.hints?.assetTypes ?? [])] };
  if (hints.title.length > 200 || hints.description.length > 1_000 || hints.assetTypes.length > localPlanAssetLimit
    || hints.assetTypes.some((type) => !quickPlanAssetCatalog.some(({ id }) => id === type))) throw new Error('Invalid plan hints');
  const state: BrowserState<T> = {
    assistant: new LocalPlanAssistant(options.model),
    path: `/${randomBytes(24).toString('hex')}`, csrf: randomBytes(24).toString('hex'), scriptNonce: randomBytes(16).toString('hex'), port: 0,
    sources: [], draft: null, reviewAsset: null, clarification: null,
    selectedTeamId: options.teams?.find((team) => team.name.trim().toLowerCase() === 'all members')?.id ?? '', selectedAssetType: '',
    hints,
    busy: false, creating: false, interruptedDuringCreate: false, done: false,
    inference: new AbortController(), finish: () => {},
  };
  const sockets = new Set<Socket>();
  const result = new Promise<T>((resolve, reject) => {
    state.finish = (value, error) => {
      if (state.done) return;
      state.done = true;
      state.inference.abort();
      state.sources = [];
      state.draft = null;
      state.reviewAsset = null;
      if (error) reject(error); else resolve(value as T);
    };
  });
  const server = createServer((request, response) => { void handleRequest(request, response, state, options); });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const abort = () => { if (state.creating) state.interruptedDuringCreate = true; else state.finish(undefined, new Error('local_plan_canceled')); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    state.port = (server.address() as { port: number }).port;
    if (options.signal?.aborted) abort();
    else options.open(`http://127.0.0.1:${state.port}${state.path}`);
    const timer = setTimeout(() => { if (state.creating) state.interruptedDuringCreate = true; else state.finish(undefined, new Error('local_plan_expired')); }, options.timeoutMs ?? 300_000);
    try { return await result; } finally { clearTimeout(timer); }
  } finally {
    options.signal?.removeEventListener('abort', abort);
    state.inference.abort();
    state.sources = [];
    state.draft = null;
    state.reviewAsset = null;
    for (const socket of sockets) socket.destroy();
    server.close();
  }
}

function renderPage<T>(state: BrowserState<T>, options: BrowserOptions<T>, message = '', error = false, messageValue?: string) {
  return renderLocalPlanPage({
    path: state.path, csrf: state.csrf, scriptNonce: state.scriptNonce, draft: state.draft, reviewAsset: state.reviewAsset, clarification: state.clarification,
    busy: state.busy, selectedTeamId: state.selectedTeamId,
    candidateAssetTypes: new LocalPlanSources(state.sources).assetCandidates(), selectedAssetType: state.selectedAssetType,
    hints: { ...state.hints,
      title: new LocalPlanSources(state.sources).explicitName('plan') ?? state.hints.title,
      description: new LocalPlanSources(state.sources).explicitDescription() ?? state.hints.description },
    hasPreviousInput: state.sources.length > 0,
    ...(state.sources.length === 1 && state.sources[0]?.kind === 'message' ? { editableInput: state.sources[0].text } : {}),
    originalInputs: state.clarification || state.reviewAsset && !state.draft ? state.sources.map((source) => source.kind === 'message'
      ? source.text : Object.entries(source.fields).map(([key, value]) => `${key}: ${value}`).join('\n')) : [],
    ...(options.fontFile ? { fontUrl: `${state.path}/font-app.ttf`, iconFontUrl: `${state.path}/font-icons.ttf` } : {}),
    messageValue: messageValue ?? '',
    fieldValues: state.draft ? Object.fromEntries(Object.entries(state.draft.asset.fields).map(([field, ref]) => {
      const source = state.sources.find((item) => item.id === ref.sourceId);
      const value = source?.kind === 'message' && 'start' in ref ? source.text.slice(ref.start, ref.end)
        : source?.kind === 'fields' && 'key' in ref ? source.fields[ref.key] : undefined;
      return [field, value ?? ''];
    })) : {},
    ...(state.draft?.assets ? { fieldValuesByAsset: state.draft.assets.map((asset) => Object.fromEntries(Object.entries(asset.fields).map(([field, ref]) => {
      const source = state.sources.find((item) => item.id === ref.sourceId);
      const value = source?.kind === 'message' && 'start' in ref ? source.text.slice(ref.start, ref.end)
        : source?.kind === 'fields' && 'key' in ref ? source.fields[ref.key] : undefined;
      return [field, value ?? ''];
    }))) } : {}),
    ...(options.context ? { context: options.context } : {}), ...(options.teams ? { teams: options.teams } : {}),
  }, message, error);
}

async function suggestWithinTimeout<T>(state: BrowserState<T>, sources: readonly LocalSource[],
  currentDraft: LocalPlanDraft | null, selectedAssetType?: string) {
  const deadline = AbortSignal.timeout(localPlanSuggestionTimeoutMs - 1_000);
  const signal = AbortSignal.any([state.inference.signal, deadline]);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error(deadline.aborted ? 'local_plan_suggestion_timeout' : 'local_plan_canceled'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([state.assistant.suggest(sources, currentDraft, signal, selectedAssetType), aborted]);
  } catch (error) {
    if (deadline.aborted) throw new Error('local_plan_suggestion_timeout');
    throw error;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function handleRequest<T>(request: IncomingMessage, response: ServerResponse, state: BrowserState<T>, options: BrowserOptions<T>): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${state.scriptNonce}'; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  if (request.headers.host !== `127.0.0.1:${state.port}`) { response.writeHead(403).end(); return; }
  if (options.fontFile && request.url === `${state.path}/font-app.ttf` && request.method === 'GET') {
    try { response.writeHead(200, { 'Content-Type': 'font/ttf' }).end(await readFile(options.fontFile)); }
    catch { response.writeHead(404).end(); }
    return;
  }
  if (options.fontFile && request.url === `${state.path}/font-icons.ttf` && request.method === 'GET') {
    try { response.writeHead(200, { 'Content-Type': 'font/ttf' }).end(await readFile(new URL('./font-icons.ttf', options.fontFile))); }
    catch { response.writeHead(404).end(); }
    return;
  }
  if (request.url !== state.path) { response.writeHead(404).end(); return; }
  if (state.done) { response.writeHead(410).end(); return; }
  if (request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderPage(state, options)); return; }
  if (request.method !== 'POST') { response.writeHead(405).end(); return; }
  if (request.headers.origin !== `http://127.0.0.1:${state.port}`) { response.writeHead(403).end(); return; }
  let ownsLock = false;
  let attemptedMessage = '';
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > limit) tooLarge = true;
      else chunks.push(chunk as Buffer);
    }
    if (tooLarge) throw new Error('Input too large');
    const body = Buffer.concat(chunks).toString('utf8');
    const contentType = request.headers['content-type'] ?? '';
    const data = contentType.startsWith('application/x-www-form-urlencoded') ? new URLSearchParams(body) : parseMultipart(body, contentType);
    if (data.get('csrf') !== state.csrf) { response.writeHead(403).end(); return; }
    if (state.done) { response.writeHead(410).end(); return; }
    const action = data.get('action');
    if (action === 'cancel' && !state.creating) {
      response.once('finish', () => state.finish(undefined, new Error('local_plan_canceled')));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderLocalPlanCanceledPage());
      return;
    }
    if (state.busy || state.creating) { response.writeHead(409).end(); return; }
    if (action === 'restart') {
      state.sources = [];
      state.draft = null;
      state.reviewAsset = null;
      state.clarification = null;
      state.selectedAssetType = '';
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderPage(state, options));
      return;
    }
    if (action === 'suggest-asset' && (state.reviewAsset || state.draft)) {
      const type = data.get('assetType') ?? '';
      const value = data.get('assetPrompt') ?? '';
      if (!quickPlanAssetCatalog.some(({ id }) => id === type) || !value.trim() || value.length > localPlanInputLimits.message) throw new Error('Invalid asset suggestion');
      state.busy = true;
      ownsLock = true;
      try {
        const source: LocalSource = { id: randomBytes(8).toString('hex'), kind: 'message', text: value };
        const suggestion = type === 'PLAIN-TEXT'
          ? LocalPlanDraftValue.from({ title: 'Asset preview', asset: { type, name: 'Plain text', fields: { text: { sourceId: source.id, start: 0, end: value.length } } }, questions: [], unassignedSources: [] }, [source]).draft
          : await suggestWithinTimeout(state, [source], null, type);
        if (!('asset' in suggestion) || (suggestion as LocalPlanDraft).assets || (suggestion as LocalPlanDraft).asset.type !== type) {
          response.writeHead(422, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'Add a labeled value for this asset.' }));
          return;
        }
        const assetSuggestion = suggestion as LocalPlanDraft;
        const fields = Object.fromEntries(Object.entries(assetSuggestion.asset.fields).map(([field, ref]) => [field,
          'start' in ref ? value.slice(ref.start, ref.end) : '']));
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ name: assetSuggestion.asset.name, fields }));
      } finally { state.busy = false; }
      return;
    }
    if (action === 'choose' && state.sources.length > 0 && (state.draft || state.reviewAsset || state.clarification)) {
      const choice = data.get('assetType') ?? '';
      const definition = quickPlanAssetCatalog.find(({ id }) => id === choice);
      if (!definition) throw new Error('Invalid asset selection');
      state.busy = true;
      ownsLock = true;
      try { const suggestion = await suggestWithinTimeout(state, state.sources, state.draft, choice);
        if (!state.done) {
          const title = (state.draft?.title ?? state.reviewAsset?.title ?? new LocalPlanSources(state.sources).explicitName('plan') ?? state.hints.title) || 'New plan';
          const name = state.draft?.asset.name ?? state.reviewAsset?.name ?? title;
          state.selectedAssetType = choice;
          state.draft = 'asset' in suggestion ? suggestion : null;
          state.reviewAsset = 'asset' in suggestion ? null : { type: choice, title, name, fields: definition.fields };
          state.clarification = 'asset' in suggestion ? null : suggestion;
        }
      } finally { state.busy = false; }
      if (state.done) { response.writeHead(410).end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderPage(state, options));
      return;
    }
    if (action === 'infer' || action === 'review' || action === 'revise') {
      state.busy = true;
      ownsLock = true;
      const message = data.get('message')?.trim() ?? '';
      attemptedMessage = message;
      const file = data.get('file') ?? '';
      if (!message && !file && action !== 'review') throw new Error('Enter a message or select a text file');
      if (message.length > localPlanInputLimits.message || file.length > localPlanInputLimits.file) throw new Error('Input too long');
      if (Buffer.byteLength(file, 'utf8') > localPlanInputLimits.fileBytes) throw new Error('Text file too large');
      const nextSources = action === 'revise' ? [] : [...state.sources];
      if (message) nextSources.push({ id: randomBytes(8).toString('hex'), kind: 'message', text: message });
      if (file) {
        const name = data.get('fileName') ?? '';
        if (!/\.(?:env|json|txt)$/i.test(name)) throw new Error('Use a .env, .json, or .txt file');
        const parsed = LocalPlanSource.parse(randomBytes(8).toString('hex'), file).value;
        const multipleAssets = parsed.kind === 'fields' && !file.trimStart().startsWith('{')
          && Object.keys(parsed.fields).length > 1 && new LocalPlanSources([parsed]).assetCandidates().length !== 1;
        nextSources.push(multipleAssets ? { id: parsed.id, kind: 'message', text: file } : parsed);
      }
      if (nextSources.length > 100) throw new Error('Too many sources');
      if (action === 'review') {
        const sources = new LocalPlanSources(nextSources);
        const candidates = sources.assetCandidates();
        const type = state.selectedAssetType || (candidates.length === 1 ? candidates[0]! : 'PLAIN-TEXT');
        const definition = quickPlanAssetCatalog.find(({ id }) => id === type)!;
        const title = sources.explicitName('plan') || state.hints.title || 'New plan';
        state.sources = nextSources;
        state.reviewAsset = { type, title, name: sources.explicitName('asset') ?? (type === 'USER-PSWD' ? sources.accountContextName() : undefined) ?? title, fields: definition.fields };
        state.selectedAssetType = type;
        state.draft = null;
        state.clarification = null;
        state.busy = false;
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderPage(state, options));
        return;
      }
      const choice = action === 'revise' ? undefined : state.selectedAssetType || undefined;
      try { const suggestion = await suggestWithinTimeout(state, nextSources, action === 'revise' ? null : state.draft, choice); if (!state.done) {
        if (action === 'revise' && !('asset' in suggestion)) {
          state.busy = false;
          response.writeHead(422, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderPage(state, options,
            'Add more detail or edit the assets directly.', true, message));
          return;
        }
        state.sources = nextSources;
        state.selectedAssetType = choice ?? '';
        state.draft = 'asset' in suggestion ? suggestion : null;
        const repeated = !('asset' in suggestion) && state.clarification?.questions.some((question) => suggestion.questions.includes(question));
        if (repeated) {
          const sources = new LocalPlanSources(nextSources);
          const type = choice ?? 'PLAIN-TEXT';
          const title = (sources.explicitName('plan') ?? state.hints.title) || 'Protected value';
          state.reviewAsset = { type, title, name: sources.explicitName('asset') ?? title,
            fields: quickPlanAssetCatalog.find(({ id }) => id === type)!.fields };
        } else state.reviewAsset = 'asset' in suggestion ? null : state.reviewAsset;
        state.clarification = 'asset' in suggestion || repeated ? null : suggestion;
      } }
      finally { state.busy = false; }
      if (state.done) { response.writeHead(410).end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderPage(state, options));
      return;
    }
    if (action === 'create' && (state.draft || state.reviewAsset)) {
      state.busy = true;
      ownsLock = true;
      const nextSources = [...state.sources];
      const manualCount = Number(data.get('manualAssetCount') ?? 0);
      if (manualCount && (!Number.isSafeInteger(manualCount) || manualCount < 1 || manualCount > 100)) throw new Error('Invalid asset count');
      const additionalCount = Number(data.get('additionalAssetCount') ?? 0);
      const baseAssets = state.draft?.assets ?? (state.draft ? [state.draft.asset] : []);
      if (!Number.isSafeInteger(additionalCount) || additionalCount < 0 || additionalCount > 100) throw new Error('Invalid asset count');
      const currentAssets = manualCount
        ? Array.from({ length: manualCount }, (_, index) => ({ type: data.get(`type:${index}`) ?? '', name: '', fields: {} }))
        : [...(baseAssets.length ? baseAssets : [{ type: state.reviewAsset!.type, name: state.reviewAsset!.name, fields: {} }]),
          ...Array.from({ length: additionalCount }, (_, offset) => ({ type: data.get(`type:${baseAssets.length + offset}`) ?? '', name: '', fields: {} }))];
      const assets = currentAssets.flatMap((asset, index) => {
        if (data.has(`remove:${index}`)) return [];
        const definition = quickPlanAssetCatalog.find(({ id }) => id === asset.type);
        if (!definition) throw new Error('Invalid asset type');
        const fields = { ...asset.fields };
        for (const field of definition.fields) {
          const replacement = data.get(manualCount ? index ? `field:${index}:${field}` : `field:${field}`
            : baseAssets.length > 1 || index > 0 ? `field:${index}:${field}` : `field:${field}`);
          if (replacement) {
            const source: LocalSource = { id: randomBytes(8).toString('hex'), kind: 'message', text: replacement };
            nextSources.push(source);
            fields[field] = { sourceId: source.id, start: 0, end: replacement.length };
          }
        }
        return [{ type: asset.type, name: data.get(manualCount ? index ? `name:${index}` : 'name'
          : baseAssets.length > 1 || index > 0 ? `name:${index}` : 'name') ?? '', fields }];
      });
      if (!assets.length || assets.length > localPlanAssetLimit) throw new Error('Invalid asset count');
      const changed = { title: data.get('title') ?? '',
        ...(assets.length > 1 ? { assets } : { asset: assets[0] }),
        questions: state.draft?.questions ?? state.clarification?.questions ?? [],
        unassignedSources: state.draft?.unassignedSources ?? state.clarification?.unassignedSources ?? [] };
      const valid = LocalPlanDraftValue.from(changed, nextSources).draft;
      const input = state.assistant.confirm(valid, nextSources);
      const description = (data.get('description') ?? '').trim();
      if (description.length > 1_000 || input.assets.some((asset) => Object.values(asset.secret).some((value) => typeof value === 'string' && value && description.includes(value)))) throw new Error('Invalid plan description');
      state.hints.title = valid.title;
      state.hints.description = description;
      const teamId = data.get('teamId') ?? '';
      if (teamId && !(options.teams ?? []).some((team) => team.id === teamId)) throw new Error('Invalid audience');
      state.sources = nextSources;
      state.draft = valid;
      state.reviewAsset = null;
      state.selectedTeamId = teamId;
      state.creating = true;
      const created = await options.create({ ...input, ...(description ? { description } : {}), ...(teamId ? { teamId } : {}) });
      response.once('finish', () => state.finish(created));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderLocalPlanResultPage(created, options.fontFile ? `${state.path}/font-app.ttf` : undefined));
      return;
    }
    response.writeHead(400).end();
  } catch (error) {
    if (ownsLock) state.busy = false;
    if (state.done) return;
    if (ownsLock && state.creating) {
      state.creating = false;
      if (state.interruptedDuringCreate) {
        response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>Plan creation failed. You can close this window.</p>');
        state.finish(undefined, error instanceof Error ? error : new Error('local_plan_creation_failed'));
      } else {
        response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderPage(state, options, 'Plan creation failed. Review and retry.', true));
      }
      return;
    }
    const timedOut = error instanceof Error && error.message === 'local_plan_suggestion_timeout';
    const message = timedOut ? 'Suggestion took longer than 90 seconds. Try again or set up the assets manually.'
      : error instanceof Error && error.message === 'local_plan_out_of_scope'
      ? 'Describe the assets or provide labeled values for this plan.'
      : error instanceof Error && ['Input too large', 'Input too long', 'Text file too large', 'Enter a message or select a text file', 'Too many sources', 'Use a .env, .json, or .txt file', 'Repeated asset field; provide one value per field'].includes(error.message)
        ? error.message : 'Unable to continue. Check your input and try again.';
    response.writeHead(timedOut ? 504 : 400, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderPage(state, options, message, true, attemptedMessage));
  }
}

function parseMultipart(body: string, contentType: string): URLSearchParams {
  const boundary = /^multipart\/form-data; boundary=([A-Za-z0-9'()+_,.\/-]{1,200})$/.exec(contentType)?.[1];
  if (!boundary) throw new Error('Invalid form');
  const data = new URLSearchParams();
  for (const part of body.split(`--${boundary}`).slice(1, -1)) {
    const split = part.indexOf('\r\n\r\n');
    if (split < 0) throw new Error('Invalid form');
    const header = part.slice(0, split);
    const name = /name="(csrf|action|message|file)"/.exec(header)?.[1];
    if (!name) throw new Error('Invalid form field');
    const value = part.slice(split + 4).replace(/\r\n$/, '');
    if (data.has(name)) throw new Error('Duplicate form field');
    data.set(name, value);
    if (name === 'file') data.set('fileName', /filename="([^"\\/]{1,200})"/.exec(header)?.[1] ?? '');
  }
  return data;
}
