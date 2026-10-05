import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { LocalPlanModel } from './local-plan-assistant.js';
import { ProtectionValueDetector } from './plan-suggestion/protection-value-detector.js';
import { freePort, localPlanCandidatePrompt, localPlanEntryPrompt, localPlanSystemPrompt, responseSchema, socketRequest } from './llama-plan-model-support.js';

/** Starts an owned llama-server for this model instance. Paths must be verified by the installer. */
export class LlamaPlanModel implements LocalPlanModel {
  private child: ChildProcess | undefined;
  private server: ServerConnection | undefined;
  private keyDirectory: string | undefined;
  private busy = false;
  private generation = 0;
  private activeController: AbortController | undefined;

  constructor(private readonly executablePath: string, private readonly modelPath: string) {
    if (!isAbsolute(executablePath) || !isAbsolute(modelPath)) {
      throw new Error('Invalid local model paths');
    }
  }

  stop(): void {
    this.generation++;
    this.activeController?.abort();
    this.child?.kill();
    this.child = undefined;
    this.server = undefined;
    const directory = this.keyDirectory;
    this.keyDirectory = undefined;
    if (directory) void rm(directory, { recursive: true, force: true }).catch(() => {});
  }

  async infer(request: InferenceRequest, signal: AbortSignal): Promise<unknown> {
    if (this.busy) throw new Error('Local model busy');

    if (JSON.stringify(request.sources).length > 64_000) throw new Error('Local model input too large');

    // Candidate requests already carry masked sources and stable IDs from the assistant.
    const modelSources = request.candidates?.length ? request.sources : new ProtectionValueDetector().detect(request.sources).modelSources;
    if (request.candidates?.length) {
      const sourceText = JSON.stringify(modelSources);
      if (request.candidates.some(({ id }) => !sourceText.includes(`[${id}]`))) throw new Error('Invalid candidate input');
    }
    const prompt = JSON.stringify(request.candidates?.length
      ? { text: modelSources.map((source) => source.kind === 'message' ? source.text
        : Object.entries(source.fields).map(([key, value]) => `${key}=${value}`).join('\n')).join('\n'), candidates: request.candidates }
      : { ...request, sources: modelSources });
    if (prompt.length > 64_000) throw new Error('Local model input too large');

    const timeout = AbortSignal.timeout(90_000);
    const controller = new AbortController();
    this.activeController = controller;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    timeout.addEventListener('abort', abort, { once: true });

    this.busy = true;
    const generation = this.generation;
    try {
      if (signal.aborted) throw new Error('Local model cancelled');
      if (!this.server) {
        this.keyDirectory = await mkdtemp(join(tmpdir(), 'inheriti-llama-'));
        if (generation !== this.generation) throw new Error('Local model cancelled');
        const server = await this.startServer(this.keyDirectory, controller.signal);
        if (generation !== this.generation) throw new Error('Local model cancelled');
        await this.waitUntilReady(server, controller.signal);
        if (generation !== this.generation) throw new Error('Local model cancelled');
        this.server = server;
      }
      const server = this.server;
      return await this.requestSuggestion(server, request, prompt, controller.signal);
    } catch {
      this.stop();
      throw new Error(signal.aborted ? 'Local model cancelled' : 'Local model unavailable');
    } finally {
      signal.removeEventListener('abort', abort);
      timeout.removeEventListener('abort', abort);
      if (this.activeController === controller) this.activeController = undefined;
      this.busy = false;
    }
  }

  private async startServer(directory: string, signal: AbortSignal): Promise<ServerConnection> {
    const socketPath = process.platform === 'win32' ? undefined : join(directory, 'model.sock');
    const port = socketPath ? undefined : await freePort();
    if (signal.aborted) throw new Error('Local model cancelled');
    const key = randomBytes(32).toString('hex');
    const keyFile = join(directory, 'api-key');
    await writeFile(keyFile, `${key}\n`, { mode: 0o600 });
    const child = spawn(
      this.executablePath,
      [
        '--model', this.modelPath,
        '--host', socketPath ?? '127.0.0.1',
        ...(port ? ['--port', String(port)] : []),
        '--ctx-size', '4096',
        '--no-webui',
        '--no-slots',
        '--no-cache-prompt',
        '--log-disable',
        '--offline',
        '--reasoning', 'off',
        '--cors-origins', 'http://127.0.0.1',
        '--no-cors-credentials',
        '--api-key-file', keyFile,
      ],
      { env: {}, stdio: 'ignore', windowsHide: true },
    );
    this.child = child;

    const exited = new Promise<never>((_, reject) => {
      child.once('error', () => reject(new Error('Local model unavailable')));
      child.once('exit', () => reject(new Error('Local model unavailable')));
    });
    void exited.catch(() => {});
    return {
      socketPath,
      endpoint: `http://127.0.0.1:${port}`,
      key,
      exited,
    };
  }

  private async waitUntilReady(server: ServerConnection, signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) throw new Error('Local model cancelled or timed out');
      try {
        const health = server.socketPath
          ? socketRequest(server.socketPath, '/health', signal, undefined, server.key)
          : fetch(`${server.endpoint}/health`, { signal, headers: { authorization: `Bearer ${server.key}` } });
        if ((await Promise.race([health, server.exited])).ok) return;
      } catch {
        // The server may still be loading.
      }
      await Promise.race([new Promise((resolve) => setTimeout(resolve, 200)), server.exited]);
    }
  }

  private async requestSuggestion(
    server: ServerConnection,
    request: InferenceRequest,
    prompt: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const body = JSON.stringify({
      model: this.modelPath,
      stream: false,
      temperature: 0,
      max_tokens: request.candidates?.length ? Math.min(1024, 56 + request.candidates.length * 40) : 2048,
      response_format: { type: 'json_object', schema: responseSchema(request) },
      messages: [
        { role: 'system', content: request.candidates?.length ? localPlanCandidatePrompt : request.entryLabels?.length ? localPlanEntryPrompt : localPlanSystemPrompt },
        { role: 'user', content: prompt },
      ],
    });

    const completion = server.socketPath
      ? socketRequest(server.socketPath, '/v1/chat/completions', signal, body, server.key)
      : fetch(`${server.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${server.key}`,
        },
        signal,
        body,
      });
    const response = await Promise.race([completion, server.exited]);
    return this.decodeResponse(response);
  }

  private async decodeResponse(response: Response): Promise<unknown> {
    if (!response.ok) throw new Error('Local model request failed');
    if (!response.body) throw new Error('Invalid local model output');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32_000) {
        await reader.cancel();
        throw new Error('Local model output too large');
      }
      chunks.push(value);
    }

    const body = Buffer.concat(chunks).toString('utf8');
    const content = JSON.parse(body)?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length > 16_000) {
      throw new Error('Invalid local model output');
    }
    return JSON.parse(content) as unknown;
  }
}

type InferenceRequest = Parameters<LocalPlanModel['infer']>[0];

type ServerConnection = {
  socketPath: string | undefined;
  endpoint: string;
  key: string;
  exited: Promise<never>;
};
