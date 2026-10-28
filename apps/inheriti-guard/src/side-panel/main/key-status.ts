import type { SidePanelRequest, SidePanelResponse } from '../../shared/messages.js';

interface Context { readonly revision: number; readonly kind: string | undefined }

export function createKeyStatusRefresh(send: (request: SidePanelRequest) => Promise<SidePanelResponse>,
  context: () => Context, render: (owner: 'Application' | 'Organization', loaded: boolean) => void): () => Promise<void> {
  return async () => {
    const started = context();
    if (started.kind !== 'EMPTY' && started.kind !== 'PLANS') return;
    try {
      const response = await send({ type: 'get-master-key-status' });
      const current = context();
      // A delayed key result belongs to the account and panel state that requested it.
      if (current.revision !== started.revision || current.kind !== started.kind) return;
      if (response.ok && 'keyStatus' in response) render(response.keyStatus.owner, response.keyStatus.loaded);
    } catch { /* Retain the last status while the worker is unavailable. */ }
  };
}
