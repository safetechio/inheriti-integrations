import { createHash } from 'node:crypto';
import { createNativeWindowSession, createQuickPlanOperations, getLocalAssistantInstallStatus, installLocalAssistant, LlamaPlanModel, runLocalPlanBrowser } from '@safetech/inheriti-elements-core/node';
import type { CliConfiguration } from '../configuration.js';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { promptSelect } from '../render/select.js';
import { createLocalAssistantInstallPresenter } from '../render/local-assistant-install.js';
import type { LocalPlanHints } from '@safetech/inheriti-elements-core/node';

export async function createPlan(context: CliContext, configuration: CliConfiguration | undefined, terminal: Terminal, signal: AbortSignal, fontFile?: URL, hints?: LocalPlanHints): Promise<number> {
  if (!configuration?.business || !context.organization) {
    terminal.writeError('Select a Business Organisation before creating a plan.');
    return 1;
  }
  if (!terminal.interactive) {
    terminal.writeError('Plan creation requires an interactive terminal and desktop window.');
    return 1;
  }
  if (!(await context.core.getAccessToken())) {
    terminal.writeError('Sign in before creating a plan.');
    return 1;
  }
  let installation = await getLocalAssistantInstallStatus();
  if (!installation.installed) {
    terminal.write('The local model suggests assets and prefills their fields from text entered in the secure window. Review each asset before saving.');
    const answer = await promptSelect('Install the local assistant runtime and model (about 1.1 GB)?', [
      { value: 'yes', description: 'Download and install now' },
      { value: 'no', description: 'Cancel plan creation' },
    ], signal);
    if (answer !== 'yes') { terminal.write('Plan creation canceled.'); return 1; }
    const presenter = createLocalAssistantInstallPresenter(terminal);
    if (!presenter) terminal.write('Installing local assistant…');
    try {
      installation = await installLocalAssistant({ signal, onProgress: progress => presenter?.progress(progress) });
      presenter?.complete();
    } finally { presenter?.close(!installation.installed); }
  }
  const operations = createQuickPlanOperations({
    apiUrl: configuration.apiUrl,
    environment: configuration.environment,
    organizationId: context.organization.id,
    getBearerToken: () => context.core.getAccessToken(),
  });
  let teams: { id: string; name: string }[] = [];
  try { teams = (await operations.teams()).teams; }
  catch { terminal.write('Teams unavailable. You can still create a personal plan.'); }
  const model = new LlamaPlanModel(installation.executablePath, installation.modelPath);
  const windowClosed = new AbortController();
  let windowUnavailable = false;
  const window = createNativeWindowSession(reason => { windowUnavailable = reason === 'unavailable'; windowClosed.abort(); });
  const sessionSignal = AbortSignal.any([signal, windowClosed.signal]);
  let masterKeySource: { resolve: () => Promise<string> } | undefined;
  let planContext: Awaited<ReturnType<typeof operations.createContext>> | undefined;
  let inputFingerprint: string | undefined;
  let completed = false;
  try {
    terminal.write('Opening local plan assistant in a secure window…');
    const result = await runLocalPlanBrowser({
      model,
      signal: sessionSignal,
      ...(fontFile ? { fontFile } : {}),
      context: context.organization.name,
      ...(hints ? { hints } : {}),
      teams,
      open: url => window.open(url),
      create: async (input) => {
        const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        if (inputFingerprint && inputFingerprint !== fingerprint) throw new Error('plan_creation_input_changed');
        inputFingerprint = fingerprint;
        if (!masterKeySource) {
          const key = await operations.acquireKey(sessionSignal, () => terminal.write('Waiting for the Organisation key from SafeKey Mobile…'));
          if (!key) throw new Error('master_key_not_claimed');
          masterKeySource = { resolve: async () => key };
        }
        planContext ??= await operations.createContext();
        return operations.createMany({ context: planContext, ...input, masterKeySource });
      },
    });
    completed = true;
    terminal.write(`Plan ${result.planId}: ${result.status}`);
    return result.status === 'READY' ? 0 : 1;
  } catch (error) {
    if (windowUnavailable && !inputFingerprint) throw new Error('local_window_unavailable');
    throw error;
  } finally {
    if (completed) window.complete(); else window.close();
    model.stop();
  }
}
