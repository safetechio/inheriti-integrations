import { Box, Text } from 'ink';
import type { LocalAssistantInstallProgress } from '@safetech/inheriti-elements-core/node';
import type { Terminal } from '../output.js';
import { renderFrame } from './ink.js';

export function createLocalAssistantInstallPresenter(terminal: Terminal) {
  const region = terminal.createLiveRegion?.();
  if (!region) return undefined;
  let current: LocalAssistantInstallProgress = { phase: 'runtime', downloadedBytes: 0 };
  let complete = false;
  let tick = 0;
  const draw = () => region.update(renderFrame(
    <Box borderStyle="round" borderColor={complete ? 'green' : 'cyan'} paddingX={1} flexDirection="column" width={Math.min(72, terminal.columns)}>
      <Text bold color={complete ? 'green' : 'cyan'}>{complete ? '✓ Local assistant ready' : `${['⠋', '⠙', '⠹', '⠸'][tick % 4]} Installing local assistant`}</Text>
      {!complete && <Text>{description(current)}</Text>}
      {!complete && <Text dimColor>Runs on this device · Ctrl+C to cancel</Text>}
    </Box>, terminal.columns,
  ));
  const timer = setInterval(() => { tick++; draw(); }, 180);
  timer.unref();
  draw();
  return {
    progress(value: LocalAssistantInstallProgress) { current = value; },
    complete() { complete = true; draw(); },
    close(clear = false) { clearInterval(timer); if (clear) region.update(''); region.close(); },
  };
}

function description(progress: LocalAssistantInstallProgress): string {
  if (progress.phase === 'extract') return 'Extracting the local runtime…';
  if (progress.phase === 'verify') return 'Verifying the installation…';
  const label = progress.phase === 'runtime' ? 'Downloading runtime' : 'Downloading model';
  const bytes = progress.downloadedBytes ?? 0;
  const amount = `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (!progress.totalBytes) return `${label} · ${amount}`;
  return `${label} · ${Math.min(100, Math.floor(bytes / progress.totalBytes * 100))}% · ${amount} / ${(progress.totalBytes / 1_000_000).toFixed(1)} MB`;
}
