import { execFile, spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function chooseFile(mode: 'open' | 'save'): Promise<string> {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'osascript' : platform === 'win32' ? 'powershell.exe' : 'zenity';
  const args = platform === 'darwin'
    ? ['-e', mode === 'open'
      ? 'POSIX path of (choose file of type {"inheriti"} with prompt "Open an Inheriti file")'
      : 'POSIX path of (choose file name with prompt "Save an Inheriti file" default name "protected.inheriti")']
    : platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-STA', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.${mode === 'open' ? 'OpenFileDialog' : 'SaveFileDialog'}; $d.Filter = "Inheriti files (*.inheriti)|*.inheriti"; ${mode === 'save' ? '$d.DefaultExt = "inheriti"; $d.OverwritePrompt = $false; ' : ''}if ($d.ShowDialog() -eq "OK") { [Console]::Out.Write($d.FileName) }`]
      : ['--file-selection', ...(mode === 'save' ? ['--save', '--filename=protected.inheriti'] : []),
        `--title=${mode === 'save' ? 'Save' : 'Open'} an Inheriti file`, '--file-filter=Inheriti files | *.inheriti'];
  let stdout: string;
  try { ({ stdout } = await run(command, args, { timeout: 120_000, maxBuffer: 8192, windowsHide: true })); }
  catch { throw new Error('viewer_file_selection_unavailable'); }
  const path = stdout.replace(/\r?\n$/, '');
  if (!path) throw new Error('viewer_file_selection_canceled');
  return path;
}

export const chooseInheritiFile = () => chooseFile('open');
export const chooseSaveInheritiFile = () => chooseFile('save');

export async function openInheritiFile(path: string): Promise<void> {
  const fullPath = resolve(path);
  if (extname(fullPath) !== '.inheriti') throw new Error('viewer_file_invalid');
  const metadata = await lstat(fullPath).catch(() => { throw new Error('viewer_file_invalid'); });
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > 64 * 1024 * 1024)
    throw new Error('viewer_file_invalid');
  const platform = process.platform;
  const launch = (command: string, args: string[]) => new Promise<void>((accept, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.once('error', () => reject(new Error('viewer_unavailable')));
    if (platform === 'linux') child.once('spawn', () => { child.unref(); accept(); });
    else child.once('exit', (code) => code === 0 ? accept() : reject(new Error('viewer_unavailable')));
  });
  if (platform === 'darwin') {
    await launch('open', ['-a', 'Inheriti Workspace', '--', fullPath])
      .catch(() => launch('open', ['-a', 'Inheriti Viewer', '--', fullPath]));
  } else if (platform === 'win32') {
    await launch('explorer.exe', [fullPath]);
  } else {
    await launch('inheriti-workspace', [fullPath])
      .catch(() => launch('inheriti-viewer', [fullPath]));
  }
}
