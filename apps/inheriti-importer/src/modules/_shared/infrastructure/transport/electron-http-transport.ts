/**
 * Renderer-side Business API transport. It forwards every
 * request over the preload bridge to the Electron main process, which holds the
 * cookie jar and attaches CSRF. The renderer never sees a token or cookie.
 *
 * Typed against the local request and response shape.
 */

export interface HttpRequestLike {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  skipCsrf?: boolean;
  returnErrorResponse?: boolean;
}

export interface HttpResponseLike<T = unknown> {
  status: number;
  body: T;
}

export class ElectronHttpTransport {
  async request<T = unknown>(request: HttpRequestLike): Promise<HttpResponseLike<T>> {
    const bridge = window.inheriti;
    if (!bridge?.api?.request) {
      throw new Error('ELECTRON_BRIDGE_UNAVAILABLE');
    }

    if (request.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const response = await bridge.api.request({
      method: request.method,
      path: request.path,
      query: request.query,
      body: request.body,
      skipCsrf: request.skipCsrf,
    });

    if (request.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    console.debug('[importer-http]', {
      method: request.method,
      path: request.path,
      status: response.status,
      bodyKind:
        response.body === null
          ? 'null'
          : Array.isArray(response.body)
            ? 'array'
            : typeof response.body,
      hasResult: !!response.body && typeof response.body === 'object' && 'result' in response.body,
    });

    if (!request.returnErrorResponse && (response.status < 200 || response.status >= 300)) {
      const body = response.body as { message?: string; error?: string } | null;
      const message = body?.message ?? body?.error ?? 'API request failed';
      throw new Error(message);
    }

    return { status: response.status, body: response.body as T };
  }
}
