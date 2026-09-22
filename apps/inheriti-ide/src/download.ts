import { open, unlink } from 'node:fs/promises';
import { revealModeOf, revealProgressMessage } from '@safetech/inheriti-elements-core';
import type { RevealProgress } from '@safetech/inheriti-elements-core';
import { ActiveRevealRegistry } from './reveal.js';
import type { RevealCancellationToken, RevealProgressReporter } from './reveal.js';

export interface DownloadCore {
  getPlan(planId: string): Promise<{ governance?: { mode?: string }; assets: ReadonlyArray<{ id: string; code?: string; name?: string; fileName?: string; isBinary?: boolean }> }>;
  withReveal<T>(planId: string, options: { mode?: 'DIRECT' | 'GOVERNED'; signal: AbortSignal; onProgress: (progress: RevealProgress) => void }, work: (reveal: {
    exportAsset(selector: string, destination: (asset: { bytes: Uint8Array }) => Promise<void>): Promise<void>;
  }) => Promise<T>): Promise<T>;
}

export interface DownloadUi {
  withProgress<T>(task: (progress: RevealProgressReporter, token: RevealCancellationToken) => Promise<T>): Promise<T>;
  pickAsset(items: readonly { label: string; description?: string; selector: string; fileName?: string }[]): Promise<string | undefined>;
  savePath(fileName?: string): Promise<string | undefined>;
}

export async function downloadAsset(
  core: DownloadCore,
  ui: DownloadUi,
  active: ActiveRevealRegistry,
  planId: string,
  keyOwner: 'Application' | 'Organisation' = 'Application',
): Promise<boolean> {
  const plan = await core.getPlan(planId);
  const assets = plan.assets.filter((asset) => asset.isBinary).map((asset) => ({
    label: asset.name ?? asset.fileName ?? asset.code ?? asset.id,
    ...(asset.name === undefined ? {} : { description: asset.code ?? asset.id }),
    selector: asset.code ?? asset.id,
    ...(asset.fileName === undefined ? {} : { fileName: asset.fileName }),
  }));
  if (!assets.length) throw Object.assign(new Error('No binary assets in this plan.'), { code: 'download_asset_unavailable' });
  const controller = active.create();
  try {
    return await ui.withProgress(async (progress, token) => {
      const cancellation = token.onCancellationRequested(() => controller.abort());
      if (token.isCancellationRequested) controller.abort();
      let last: string | undefined;
      try {
        await core.withReveal(planId, {
          mode: revealModeOf(plan), signal: controller.signal,
          onProgress: (value) => { const line = revealProgressMessage(value, { keyOwner }); if (line !== last) { progress.report({ message: line }); last = line; } },
        }, async (reveal) => {
          const selector = await ui.pickAsset(assets);
          if (!selector || controller.signal.aborted) throw canceled();
          const fileName = assets.find((asset) => asset.selector === selector)?.fileName;
          const path = await ui.savePath(fileName);
          if (!path || controller.signal.aborted) throw canceled();
          await reveal.exportAsset(selector, async ({ bytes }) => {
            if (controller.signal.aborted) throw canceled();
            const file = await open(path, 'wx', 0o600);
            let saved = false;
            try { await file.writeFile(bytes); if (controller.signal.aborted) throw canceled(); saved = true; }
            finally { await file.close(); if (!saved) await unlink(path); }
          });
        });
        return true;
      } catch (error) {
        if (controller.signal.aborted) throw canceled();
        throw error;
      } finally { cancellation.dispose(); }
    });
  } finally { active.release(controller); }
}

function canceled(): Error { return Object.assign(new Error('reveal_canceled'), { name: 'AbortError' }); }
