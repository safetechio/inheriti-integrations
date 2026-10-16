import {
  createNativeWindowSession,
  createAwsSecretPublisher,
  createGoogleSecretPublisher,
  revealModeOf,
  revealProgressMessage,
} from '@safetech/inheriti-elements-core/node-base';
import {
  deliverAssetInBrowser,
  deliverFieldsInBrowser,
  deliverSelectionInBrowser,
  deliverInBrowser,
} from '../local-browser.js';
import { openSafeKeyProPrompt } from '../safekey-pro.js';
import { pendingJobInstruction } from '../tools/reveal-instruction.js';
import type { MetadataTools } from '../server.js';
import type { RevealActionDestination } from '@safetech/inheriti-elements-core';
import { coded, lifecycleMessages, safeErrorCode } from './errors.js';

const publishedValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw coded('request_failed');
  return encoded;
};
// The installed Client SDK destination union predates these server-supported AWS destinations.
const publicationDestination = (value: 'AWS_SECRETS_MANAGER' | 'AWS_PARAMETER_STORE' | 'GOOGLE_CLOUD_SECRET_MANAGER') => value as RevealActionDestination;

export async function reveal(this: MetadataTools, planId: string, selector: string, kind: 'FIELD' | 'ASSET' = 'FIELD') {
  return this.startReveal(
    planId,
    kind === 'ASSET' ? { kind, asset: selector } : { kind, selectors: [selector], single: true },
  );
}
export async function revealFields(
  this: MetadataTools,
  planId: string,
  selection: {
    selector?: string | undefined;
    selectors?: string[] | undefined;
    assets?: string[] | undefined;
    all?: boolean | undefined;
  },
) {
  const choices =
    Number(selection.selector !== undefined) +
    Number(selection.selectors !== undefined || selection.assets !== undefined) +
    Number(selection.all !== undefined);
  if (choices !== 1 || (selection.all !== undefined && selection.all !== true)) throw coded('asset_selector_invalid');
  if (selection.selector !== undefined) return this.reveal(planId, selection.selector);
  return this.startReveal(planId, {
    kind: 'FIELD',
    selectors: selection.selectors,
    assets: selection.assets,
    all: selection.all,
    single: false,
  });
}
export async function startReveal(
  this: MetadataTools,
  planId: string,
  request:
    | { kind: 'ASSET'; asset: string }
    | {
        kind: 'FIELD';
        selectors?: string[] | undefined;
        assets?: string[] | undefined;
        all?: boolean | undefined;
        single: boolean;
        publication?: { provider: 'AWS'; region: string; expectedAccountId: string; mappings: ReadonlyArray<{ selector: string; key: string }>; secretName?: string; parameterPrefix?: string }
          | { provider: 'GOOGLE_CLOUD'; projectId: string; secretPrefix: string; mappings: ReadonlyArray<{ selector: string; key: string }> };
      },
) {
  const kind = request.kind;
  if (request.kind === 'ASSET') {
    if (!/^[^\s.]+$/.test(request.asset)) throw coded('asset_selector_invalid');
  }
  if (request.kind === 'FIELD' && !request.all) {
    if (!request.selectors?.length && !request.assets?.length) throw coded('asset_selector_invalid');
    if (
      request.selectors !== undefined &&
      (!request.selectors.length || request.selectors.some((selector) => !/^[^\s.]+\.[^\s.]+$/.test(selector)))
    )
      throw coded('asset_selector_invalid');
    if (
      request.assets !== undefined &&
      (!request.assets.length || request.assets.some((asset) => !/^[^\s.]+$/.test(asset)))
    )
      throw coded('asset_selector_invalid');
  }
  const version = this.selectionVersion;
  const selected = await this.selected();
  if (!('organizationId' in selected)) return selected;
  if (version !== this.selectionVersion) throw coded('organization_selection_changed');
  if (this.job?.status === 'WAITING') throw coded('reveal_in_progress');
  const controller = new AbortController();
  const windowState = { unavailable: false };
  const window = createNativeWindowSession((reason) => {
    windowState.unavailable = reason === 'unavailable';
    controller.abort();
  });
  const job: NonNullable<typeof this.job> = {
    id: crypto.randomUUID(),
    planId,
    organizationId: selected.organizationId,
    phase: 'STARTING',
    status: 'WAITING',
    controller,
    done: Promise.resolve(),
  };
  this.job = job;
  job.done = (async () => {
    const plan = await selected.core.getPlan(planId);
    const knownSelectors = (plan.assets ?? [])
      .filter((asset) => !asset.isBinary)
      .flatMap((asset) => (asset.fieldNames ?? []).map((field) => `${asset.code ?? asset.id}.${field}`));
    const selectors =
      request.kind === 'FIELD' ? Array.from(new Set(request.all ? knownSelectors : (request.selectors ?? []))) : [];
    const binaryAssets = (plan.assets ?? []).filter((asset) => asset.isBinary);
    const knownAssets = binaryAssets.map((asset) => asset.code ?? asset.id);
    const assets =
      request.kind === 'FIELD'
        ? Array.from(
            new Set(
              request.all
                ? knownAssets
                : (request.assets ?? []).map((selector) => {
                    const asset = binaryAssets.find((asset) => asset.id === selector || asset.code === selector);
                    return asset?.code ?? asset?.id ?? selector;
                  }),
            ),
          )
        : [];
    if (request.kind === 'FIELD') {
      if (!selectors.length && !assets.length) throw coded('asset_selector_invalid');
      if (plan.assets && selectors.some((selector) => !knownSelectors.includes(selector)))
        throw coded('asset_field_not_found');
      if (plan.assets && assets.some((asset) => !knownAssets.includes(asset))) throw coded('asset_not_found');
      if (request.publication && (assets.length || selectors.length !== request.publication.mappings.length ||
        selectors.some((value, index) => value !== request.publication!.mappings[index]?.selector)))
        throw coded('asset_selector_invalid');
    }
    const publicationSummary = () => {
      if (request.kind !== 'FIELD' || !request.publication) return selectors.concat(assets).join(', ');
      const publication = request.publication;
      if (publication.provider === 'GOOGLE_CLOUD') return `Google Cloud Secret Manager project ${publication.projectId}; ${publication.mappings.map(item => `${item.selector} → ${publication.secretPrefix}${item.key}`).join(', ')}`;
      return `${publication.secretName ? 'AWS Secrets Manager' : 'AWS SSM Parameter Store'} ${publication.region} account ${publication.expectedAccountId}; ${publication.mappings.map(item => `${item.selector} → ${publication.secretName ? `${publication.secretName} key ${item.key}` : `${publication.parameterPrefix}/${item.key}`}`).join(', ')}`;
    };
    const selector = request.kind === 'ASSET' ? request.asset : publicationSummary();
    const moderators = (plan.participants ?? []).filter(
      (participant) => participant.lifecycle === 'ACTIVE' && participant.relationships.includes('MODERATOR'),
    );
    const moderatorNamesById = new Map(moderators.map((participant) => [participant.id, participant.displayName]));
    if (controller.signal.aborted || version !== this.selectionVersion || this.job !== job)
      throw coded('organization_selection_changed');
    const prompt = await openSafeKeyProPrompt(
      this.config?.deployment,
      process.env.INHERITI_SAFEKEY_PRO_DEVICE,
      {
        organizationId: selected.organizationId,
        planId,
        selector,
        kind: request.kind === 'FIELD' && !request.single ? 'SELECTION' : kind,
        ...(request.kind === 'FIELD' && request.publication ? { completionMessage: `The selected fields were published to ${request.publication.provider === 'AWS' ? 'AWS' : 'Google Cloud'}. Check the MCP job status for the result.` } : {}),
      },
      controller.signal,
      (url) => window.open(url),
    );
    const delivery = { completed: false };
    try {
      await selected.core.withReveal(
        planId,
        {
          mode: revealModeOf(plan),
          signal: controller.signal,
          selectCustodianDevice: prompt.selectCustodianDevice,
          ...(prompt.proDevice ? { proDevice: prompt.proDevice } : {}),
          onProgress: (progress) => {
            job.phase = progress.phase;
            const session = progress.session;
            job.progress = session
              ? {
                  revealId: session.id,
                  expiresAt: session.expiresAt,
                  ...(session.dmsExpiresAt === undefined ? {} : { dmsExpiresAt: session.dmsExpiresAt }),
                  ...(session.governanceExpiresAt === undefined
                    ? {}
                    : { governanceExpiresAt: session.governanceExpiresAt }),
                  ...(session.governanceGate === undefined ? {} : { governanceGate: session.governanceGate }),
                  ...(session.approvedModerators === undefined
                    ? {}
                    : { approvedModerators: session.approvedModerators }),
                  ...(session.requiredModerators === undefined
                    ? {}
                    : { requiredModerators: session.requiredModerators }),
                  ...(session.deniedBy === undefined ? {} : { deniedBy: session.deniedBy }),
                  ...(session.closedReason === undefined ? {} : { closedReason: session.closedReason }),
                }
              : {};
            job.message = revealProgressMessage(progress, {
              moderators: moderators.map((participant) => participant.displayName),
              moderatorNamesById,
              keyOwner: 'Organisation',
            });
          },
        },
        async (reveal) => {
          if (request.kind === 'FIELD' && request.publication) {
            const publication = request.publication;
            const active = () => {
              if (controller.signal.aborted || version !== this.selectionVersion || this.job !== job)
                throw coded('local_delivery_canceled');
            };
            if (publication.provider === 'GOOGLE_CLOUD') {
              const publisher = createGoogleSecretPublisher({ projectId: publication.projectId });
              job.message = 'Publishing approved fields to Google Cloud Secret Manager.';
              for (const mapping of publication.mappings) {
                active();
                await reveal.consumeFields([{ selector: mapping.selector,
                  options: { action: 'USE_FIELD', destination: publicationDestination('GOOGLE_CLOUD_SECRET_MANAGER') } }], async fields => {
                  active();
                  await publisher.publishSecret(`${publication.secretPrefix}${mapping.key}`, publishedValue(fields[0]!.value), controller.signal);
                });
              }
              return;
            }
            const publisher = createAwsSecretPublisher({ region: publication.region, expectedAccountId: publication.expectedAccountId });
            job.message = 'Publishing approved fields to AWS.';
            if (publication.secretName) {
              await reveal.consumeFields(selectors.map(selector => ({ selector,
                options: { action: 'USE_FIELD', destination: publicationDestination('AWS_SECRETS_MANAGER') } })), async fields => {
                active();
                await publisher.publishSecret(publication.secretName!, fields.map((field, index) => ({
                  key: publication.mappings[index]!.key, value: publishedValue(field.value),
                })), controller.signal);
              });
              return;
            }
            for (const mapping of publication.mappings) {
              active();
              await reveal.consumeFields([{ selector: mapping.selector,
                options: { action: 'USE_FIELD', destination: publicationDestination('AWS_PARAMETER_STORE') } }], async fields => {
                active();
                await publisher.publishParameter(`${publication.parameterPrefix}/${mapping.key}`, publishedValue(fields[0]!.value), controller.signal);
              });
            }
            return;
          }
          const deliveryTimeout = () => {
            const timeoutMs = Math.min(300_000, Date.parse(reveal.session.expiresAt) - Date.now());
            if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw coded('local_delivery_expired');
            return timeoutMs;
          };
          if (kind === 'ASSET') {
            await reveal.exportAsset(selector, async (asset) => {
              if (controller.signal.aborted || version !== this.selectionVersion || this.job !== job)
                throw coded('local_delivery_canceled');
              job.message = 'Confirm the file download in the secure window to finish delivery.';
              await deliverAssetInBrowser(asset.fileName ?? 'asset.bin', asset.bytes, {
                signal: controller.signal,
                timeoutMs: deliveryTimeout(),
                open: (url) => window.open(url),
                ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
              });
            });
            return;
          }
          const deliver = async (fields: ReadonlyArray<{ selector: string; value: unknown }>) => {
            const downloaded: Array<{ selector: string; fileName: string; bytes: Uint8Array; mimeType?: string }> = [];
            const exportNext = async (index: number): Promise<void> => {
              if (index < assets.length) {
                const assetSelector = assets[index]!;
                await reveal.exportAsset(assetSelector, async (asset) => {
                  const download = {
                    selector: assetSelector,
                    fileName: asset.fileName ?? 'asset.bin',
                    bytes: asset.bytes,
                  };
                  downloaded.push(
                    asset.mimeType
                      ? {
                          selector: download.selector,
                          fileName: download.fileName,
                          bytes: download.bytes,
                          mimeType: asset.mimeType,
                        }
                      : download,
                  );
                  await exportNext(index + 1);
                });
                return;
              }
              if (controller.signal.aborted || version !== this.selectionVersion || this.job !== job)
                throw coded('local_delivery_canceled');
              const timeoutMs = deliveryTimeout();
              job.message = assets.length
                ? 'Confirm the selection and download each file in the secure window to finish delivery.'
                : 'Confirm the selected fields in the secure window to finish delivery.';
              if (assets.length) {
                await deliverSelectionInBrowser(fields, downloaded, {
                  signal: controller.signal,
                  timeoutMs,
                  open: (url) => window.open(url),
                });
                return;
              }
              if (request.kind === 'FIELD' && request.single) {
                await deliverInBrowser(selectors[0]!, fields[0]!.value, {
                  signal: controller.signal,
                  timeoutMs,
                  open: (url) => window.open(url),
                });
                return;
              }
              await deliverFieldsInBrowser(fields, {
                signal: controller.signal,
                timeoutMs,
                open: (url) => window.open(url),
              });
            };
            await exportNext(0);
          };
          if (!selectors.length) {
            await deliver([]);
            return;
          }
          await reveal.consumeFields(
            selectors.map((selector) => ({
              selector,
              options: { action: 'DELIVER_FIELD', destination: 'LOCAL_BROWSER' },
            })),
            (fields) => deliver(fields.map((field, index) => ({ selector: selectors[index]!, value: field.value }))),
          );
        },
      );
      delivery.completed = true;
    } finally {
      prompt.close(delivery.completed ? 'complete' : controller.signal.aborted ? 'canceled' : 'failed');
    }
  })()
    .then(() => {
      job.status = 'DELIVERED';
      job.message = request.kind === 'FIELD' && request.publication
        ? `Published securely to ${request.publication.provider === 'AWS' ? 'AWS' : 'Google Cloud'}.` : 'Delivered securely.';
    })
    .catch((error) => {
      const failureCode = safeErrorCode(error);
      const code =
        failureCode === 'reveal_cancellation_failed' || failureCode === 'master_key_relay_cancellation_failed'
          ? failureCode
          : windowState.unavailable
            ? 'local_window_unavailable'
            : failureCode;
      if (code !== 'request_failed') job.code = code;
      if (code === 'reveal_cancellation_failed' || code === 'master_key_relay_cancellation_failed') {
        job.status = 'FAILED';
        job.message =
          code === 'master_key_relay_cancellation_failed'
            ? 'Could not confirm cancellation in SafeKey Mobile. The key release request may still be pending; ' +
              'wait for it to expire before trying again.'
            : 'Server cancellation could not be confirmed. Use abort_plan_access to close the interrupted request before retrying.';
        return;
      }
      if (request.kind === 'FIELD' && request.publication && controller.signal.aborted) {
        job.status = 'FAILED';
        job.code = request.publication.provider === 'AWS' ? 'automation_aws_publication_outcome_unknown' : 'google_secret_publication_outcome_unknown';
        job.message = `${request.publication.provider === 'AWS' ? 'AWS' : 'Google Cloud'} publication was interrupted. Inspect target versions before retrying; an in-flight write may have completed.`;
        return;
      }
      job.status =
        !windowState.unavailable && (controller.signal.aborted || code === 'local_delivery_canceled')
          ? 'CANCELED'
          : 'FAILED';
      if (job.status === 'CANCELED') {
        job.message = 'Reveal canceled.';
        return;
      }
      if ((error as { message?: unknown } | null)?.message === 'SAFEKEY_NO_SPACE') {
        job.message =
          'SafeKey PRO has no free space. Download SafeKey Desktop Tool at ' +
          'https://safekey.be/tools/safekey-desktop/ to free space, then start a new reveal.';
        return;
      }
      if ((error as { message?: unknown } | null)?.message === 'SAFEKEY_DEVICE_INFO_MISSING') {
        job.message = 'Could not set up SafeKey PRO. Retry the reveal.';
        return;
      }
      if (code === 'reveal_restart_required') {
        job.message =
          'This plan has an interrupted open request. Use abort_plan_access or finish it in Inheriti® Business, then start a new reveal.';
        return;
      }
      if (
        lifecycleMessages[code] &&
        !['DENIED', 'STOPPED_BY_DMS', 'EXPIRED', 'PARTICIPANT_REVOKED', 'RECONCILIATION_REQUIRED'].includes(job.phase)
      ) {
        job.message = lifecycleMessages[code];
        return;
      }
      if (
        !['DENIED', 'STOPPED_BY_DMS', 'EXPIRED', 'PARTICIPANT_REVOKED', 'RECONCILIATION_REQUIRED'].includes(job.phase)
      )
        job.message = 'Reveal could not continue.';
    })
    .finally(() => {
      if (job.status === 'DELIVERED') {
        window.complete();
        return;
      }
      window.close();
    });
  const expiry = setTimeout(() => controller.abort(), 10 * 60_000);
  void job.done.finally(() => clearTimeout(expiry));
  return {
    jobId: job.id,
    status: job.status,
    phase: job.phase,
    ...(job.progress ? { progress: job.progress } : {}),
    ...(job.message === undefined ? {} : { message: job.message }),
    ...(job.code ? { code: job.code } : {}),
    ...(job.status === 'WAITING' ? { instruction: pendingJobInstruction } : {}),
  };
}
export async function revealStatus(this: MetadataTools, jobId: string, cancel = false) {
  const job = this.job;
  if (!job || job.id !== jobId) throw coded('reveal_not_found');
  if (cancel && job.status === 'WAITING') {
    job.controller.abort();
    await job.done;
  }
  return {
    jobId: job.id,
    status: job.status,
    phase: job.phase,
    ...(job.progress ? { progress: job.progress } : {}),
    ...(job.message === undefined ? {} : { message: job.message }),
    ...(job.code ? { code: job.code } : {}),
    ...(job.status === 'WAITING' ? { instruction: pendingJobInstruction } : {}),
    ...(job.status === 'DELIVERED' ? { delivered: true } : {}),
  };
}
