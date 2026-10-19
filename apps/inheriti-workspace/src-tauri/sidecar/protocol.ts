import type { WorkspaceSession } from './session.js';

const maxLineBytes = 8192;
const safeId = /^[A-Za-z0-9_-]{1,64}$/u;
const safeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Request = { id: string; op: string; organizationId?: string; copyId?: string };
type Response = { id: string; ok: true; result: unknown } | { id: string; ok: false; code: string };

export async function handleLine(line: string, session: Pick<WorkspaceSession, 'status' | 'signIn' | 'signOut' | 'tryBrowserSignIn' | 'listOrganizations' | 'selectOrganization' | 'getFileAccess' | 'inspectStartupFile' | 'inspectStartupFileMime' | 'openStartupFile'>, onPairingCode?: (code: string) => void): Promise<Response> {
  let request: Request;
  try {
    if (Buffer.byteLength(line, 'utf8') > maxLineBytes) return { id: '', ok: false, code: 'request_too_large' };
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    request = value as Request;
    if (typeof request.id !== 'string' || !safeId.test(request.id) || typeof request.op !== 'string') throw new Error();
  } catch {
    return { id: '', ok: false, code: 'invalid_request' };
  }

  try {
    switch (request.op) {
      case 'status': return { id: request.id, ok: true, result: await session.status() };
      case 'signIn': await session.signIn(); return { id: request.id, ok: true, result: await session.status() };
      case 'signOut': await session.signOut(); return { id: request.id, ok: true, result: { signedIn: false } };
      case 'tryBrowserSignIn': await session.tryBrowserSignIn(); return { id: request.id, ok: true, result: await session.status() };
      case 'organizations': return { id: request.id, ok: true, result: await session.listOrganizations() };
      case 'selectOrganization': {
        if (typeof request.organizationId !== 'string' || !safeUuid.test(request.organizationId)) throw new Error('invalid_organization_id');
        await session.selectOrganization(request.organizationId);
        return { id: request.id, ok: true, result: await session.status() };
      }
      case 'getFileAccess': {
        if (typeof request.copyId !== 'string' || !safeUuid.test(request.copyId)) throw new Error('invalid_copy_id');
        const access = await session.getFileAccess(request.copyId);
        return { id: request.id, ok: true, result: {
          copyId: access.copyId,
          status: access.status,
          deployment: access.deployment,
          origin: access.origin,
          recipient: access.recipient,
          expiresAt: access.expiresAt,
          allowedUses: access.allowedUses,
        } };
      }
      case 'inspectStartupFile': {
        const access = await session.inspectStartupFile();
        return { id: request.id, ok: true, result: {
          copyId: access.copyId,
          status: access.status,
          deployment: access.deployment,
          origin: access.origin,
          recipient: access.recipient,
          expiresAt: access.expiresAt,
          allowedUses: access.allowedUses,
        } };
      }
      case 'inspectStartupFileMime': return { id: request.id, ok: true, result: await session.inspectStartupFileMime() };
      case 'openStartupFile': {
        const opened = await session.openStartupFile();
        return { id: request.id, ok: true, result: opened };
      }
      case 'openStartupFileFromReveal': {
        const opened = await session.openStartupFile('REVEAL', onPairingCode);
        return { id: request.id, ok: true, result: opened };
      }
      case 'openStartupFileInGuest': {
        const opened = await session.openStartupFile('MOBILE', undefined, 'guest');
        return { id: request.id, ok: true, result: opened };
      }
      case 'openStartupFileFromRevealInGuest': {
        const opened = await session.openStartupFile('REVEAL', onPairingCode, 'guest');
        return { id: request.id, ok: true, result: opened };
      }
      default: return { id: request.id, ok: false, code: 'unsupported_operation' };
    }
  } catch (error) {
    const code = error instanceof Error && ['sign_in_required', 'organization_required', 'organization_access_denied', 'invalid_organization_id', 'invalid_copy_id', 'invalid_startup_file', 'file_binding_mismatch', 'unsupported_file_type', 'file_too_large', 'file_access_unavailable', 'file_opening_expired', 'reveal_delivery_unavailable', 'opening_cancelled', 'opening_in_progress'].includes(error.message)
      ? error.message : 'operation_failed';
    return { id: request.id, ok: false, code };
  }
}

export function runProtocol(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, session: WorkspaceSession): void {
  let pending = '';
  let discarding = false;
  let closed = false;
  let chain = Promise.resolve();
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    if (closed) return;
    const parts = chunk.split('\n');
    for (const [index, segment] of parts.entries()) {
      const complete = index < parts.length - 1;
      if (discarding) {
        if (complete) {
          discarding = false;
          queue(() => ({ id: '', ok: false, code: 'request_too_large' }));
        }
        continue;
      }
      pending += segment;
      if (Buffer.byteLength(pending, 'utf8') > maxLineBytes) {
        pending = '';
        discarding = true;
      }
      if (complete) {
        if (discarding) queue(() => ({ id: '', ok: false, code: 'request_too_large' }));
        else {
          const line = pending;
          queue(() => handleLine(line, session, (code) => {
            if (/^[0-9a-f]{12}$/u.test(code) && !closed) write({ id: 'viewer', event: 'pairingCode', code });
          }));
        }
        pending = '';
        discarding = false;
      }
    }
  });
  input.on('end', close);
  input.on('error', close);
  function close(): void { closed = true; pending = ''; session.cancel(); }
  function queue(operation: () => Promise<Response> | Response): void {
    chain = chain.then(async () => {
      if (closed) return;
      const response = await operation();
      if (!closed) write(response);
    });
  }
  function write(response: Response | { id: string; event: 'pairingCode'; code: string }): void { output.write(`${JSON.stringify(response)}\n`); }
}
