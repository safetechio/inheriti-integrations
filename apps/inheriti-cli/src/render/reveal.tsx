import { Box, Text } from 'ink';
import { revealGateCountdown } from '@safetech/inheriti-elements-core';
import type { RevealProgress } from '@safetech/inheriti-elements-core';
import type { Terminal } from '../output.js';
import { renderFrame } from './ink.js';

export interface RevealModeratorView {
  id: string;
  name: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export function createRevealPresenter(
  terminal: Terminal,
  moderators: ReadonlyMap<string, string>,
  keyOwner: 'Application' | 'Organisation' = 'Application',
): { progress(value: RevealProgress): void; complete(message: string): void; close(): void } | undefined {
  const region = terminal.createLiveRegion?.();
  if (!region) return undefined;
  let current: RevealProgress = { phase: 'STARTING' };
  let tick = 0;
  let completed: string | undefined;
  const draw = () => region.update(renderFrame(
    <RevealCard progress={current} moderatorNames={moderators} spinner={SPINNER[tick % SPINNER.length]!} keyOwner={keyOwner} {...(completed === undefined ? {} : { completed })} />,
    terminal.columns,
  ));
  const timer = setInterval(() => { tick += 1; draw(); }, 90);
  timer.unref();
  draw();
  return {
    progress(value) { current = value; completed = undefined; draw(); },
    complete(message) { completed = message; draw(); },
    close() { clearInterval(timer); region.close(); },
  };
}

function RevealCard({ progress, moderatorNames, spinner, keyOwner, completed }: {
  progress: RevealProgress;
  moderatorNames: ReadonlyMap<string, string>;
  spinner: string;
  keyOwner: 'Application' | 'Organisation';
  completed?: string;
}) {
  const session = progress.session;
  const moderatorStates = (session?.moderators?.length ? session.moderators
    : [...moderatorNames.keys()].map((id) => ({ id, status: 'PENDING' as const }))).map((moderator) => ({
    id: moderator.id,
    name: moderatorNames.get(moderator.id) ?? moderator.id,
    status: moderator.status,
  }));
  const approved = session?.approvedModerators ?? moderatorStates.filter((one) => one.status === 'APPROVED').length;
  const required = session?.requiredModerators;
  const countdown = revealGateCountdown(progress);
  return <Box borderStyle="round" borderColor={completed ? 'green' : 'cyan'} paddingX={1} flexDirection="column" width={Math.min(72, Math.max(36, 120))}>
    <Text bold color={completed ? 'green' : 'cyan'}>{completed ? '✓ Reveal complete' : `${spinner} Revealing your plan`}</Text>
    <Text>{completed ?? title(progress.phase, keyOwner)}</Text>
    {!completed && countdown && <Text color="yellow">{`Time remaining  ${countdown}`}</Text>}
    {progress.phase === 'WAITING_FOR_MODERATION' && <Box marginTop={1} flexDirection="column">
      <Text bold>{`${approved}/${required ?? moderatorStates.length} approved`}</Text>
      {moderatorStates.map((moderator) => <Text key={moderator.id} color={statusColor(moderator.status)}>
        {`${statusIcon(moderator.status)} ${moderator.name}  ${moderator.status.toLowerCase()}`}
      </Text>)}
    </Box>}
    <Text dimColor>Ctrl+C to cancel</Text>
  </Box>;
}

function title(phase: RevealProgress['phase'], keyOwner: 'Application' | 'Organisation'): string {
  return {
    WAITING_FOR_MASTER_KEY: `Waiting for the ${keyOwner} key from SafeKey Mobile`,
    STARTING: 'Opening the plan.',
    WAITING_FOR_DMS: 'Waiting for the dead man’s switch',
    WAITING_FOR_AUTHENTICATION: 'Authentication request — waiting for SafeKey Mobile confirmation',
    WAITING_FOR_MODERATION: 'Waiting for moderator approval',
    WAITING_FOR_CUSTODIAN_CLAIM: 'Waiting for the custodian share to be claimed',
    WAITING_FOR_CUSTODIAN: 'Waiting for the custodian share',
    CUSTODIAN_SHARE_DISTRIBUTED: 'Custodian share sent to SafeKey Mobile',
    RELEASING_MATERIAL: 'Collecting encrypted data shares.',
    RECONSTRUCTING: 'Reconstructing and decrypting shares.',
    OPEN: 'Revealing the data.',
    CONTINUING: 'Continuing securely',
    DENIED: 'Reveal rejected', EXPIRED: 'Reveal expired', PARTICIPANT_REVOKED: 'Participant revoked',
    RECONCILIATION_REQUIRED: 'Waiting for reconciliation', STOPPED_BY_DMS: 'Reveal stopped by DMS', ENDED: 'Closing reveal',
  }[phase as RevealProgress['phase'] | 'CUSTODIAN_SHARE_DISTRIBUTED'];
}

function statusIcon(status: RevealModeratorView['status']): string {
  if (status === 'APPROVED') return '✓';
  if (status === 'REJECTED') return '✕';
  return '○';
}
function statusColor(status: RevealModeratorView['status']): 'green' | 'red' | 'gray' {
  if (status === 'APPROVED') return 'green';
  if (status === 'REJECTED') return 'red';
  return 'gray';
}
