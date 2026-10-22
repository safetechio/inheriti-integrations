import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { automationRuntimeImage } from '../src/commands/automation-runtime-image.js';

const image = '123456789012.dkr.ecr.us-east-1.amazonaws.com/app:test';
const terminal = () => ({ interactive: false, stdoutIsTTY: false, columns: 80,
  write: vi.fn(), writeError: vi.fn() });

it('previews the image without running Docker', async () => {
  const output = terminal();
  const docker = vi.fn(async () => '');
  expect(await automationRuntimeImage(output, '0.0.19-dev.0', ['--image', image], undefined, docker)).toBe(0);
  expect(docker).not.toHaveBeenCalled();
  expect(output.write).toHaveBeenCalledWith(expect.stringContaining('add --build'));
  expect(output.write).toHaveBeenCalledWith(expect.stringContaining('will add Inheriti CLI 0.0.19-dev.0'));
});

it('builds, verifies the exact CLI version, then publishes and pins the image', async () => {
  const output = terminal();
  let generatedDockerfile = '';
  const docker = vi.fn(async (args: string[]) => {
    if (args[0] === 'image' && args[1] === 'inspect') return 'node';
    if (args[0] === 'build' && args[args.indexOf('--tag') + 1] === image)
      generatedDockerfile = await readFile(args[args.indexOf('--file') + 1]!, 'utf8');
    return args[0] === 'run' ? '0.0.19-dev.0' : '';
  });
  const resolve = vi.fn(async () => `${image.slice(0, image.lastIndexOf(':'))}@sha256:${'a'.repeat(64)}`);
  expect(await automationRuntimeImage(output, '0.0.19-dev.0', ['--image', image, '--publish'], undefined, docker, resolve)).toBe(0);
  expect(docker.mock.calls.map(([args]) => args[0])).toEqual(['build', 'image', 'build', 'run', 'push', 'image']);
  expect(generatedDockerfile).toContain('RUN npm install --engine-strict --global --prefix /usr/local @safetech/inheriti-cli@0.0.19-dev.0');
  expect(generatedDockerfile).toContain('USER node');
  expect(resolve).toHaveBeenCalledWith(image, 'AWS', undefined);
  expect(output.write).toHaveBeenCalledWith(expect.stringContaining('Published image:'));
});

it('never publishes an image without the expected CLI version', async () => {
  const docker = vi.fn(async (args: string[]) => args[0] === 'run' ? '0.0.18' : '');
  await expect(automationRuntimeImage(terminal(), '0.0.19-dev.0', ['--image', image, '--publish'], undefined, docker))
    .rejects.toThrow('expected 0.0.19-dev.0');
  expect(docker.mock.calls.map(([args]) => args[0])).toEqual(['build', 'image', 'build', 'run', 'image']);
});

it('installs a local dev CLI tarball and does not push if its version mismatches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cli-test-'));
  try {
    const tarball = join(directory, 'cli.tgz');
    await writeFile(tarball, 'local artifact');
    let generatedDockerfile = '';
    let copiedTarball = '';
    const docker = vi.fn(async (args: string[]) => {
      if (args[0] === 'build' && args[args.indexOf('--tag') + 1] === image) {
        generatedDockerfile = await readFile(args[args.indexOf('--file') + 1]!, 'utf8');
        copiedTarball = await readFile(join(args.at(-1)!, 'cli.tgz'), 'utf8');
      }
      return args[0] === 'run' ? '0.0.18' : '';
    });
    await expect(automationRuntimeImage(terminal(), '0.0.19-dev.0',
      ['--image', image, '--cli-tarball', tarball, '--publish'], undefined, docker))
      .rejects.toThrow('expected 0.0.19-dev.0');
    expect(generatedDockerfile).toContain('COPY cli.tgz /tmp/inheriti-cli.tgz');
    expect(generatedDockerfile).toContain('npm install --engine-strict --global --prefix /usr/local /tmp/inheriti-cli.tgz');
    expect(copiedTarball).toBe('local artifact');
    expect(docker.mock.calls.map(([args]) => args[0])).toEqual(['build', 'image', 'build', 'run', 'image']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects an absent local tarball before Docker work', async () => {
  const docker = vi.fn(async () => '');
  const output = terminal();
  expect(await automationRuntimeImage(output, '0.0.19-dev.0',
    ['--image', image, '--cli-tarball', join(tmpdir(), 'missing-inheriti-cli.tgz'), '--build'], undefined, docker)).toBe(1);
  expect(output.writeError).toHaveBeenCalledWith(expect.stringContaining('existing .tgz file'));
  expect(docker).not.toHaveBeenCalled();
});

it('requires a tarball before building a local CLI image', async () => {
  const docker = vi.fn(async () => '');
  const output = terminal();
  expect(await automationRuntimeImage(output, '0.0.19-local.0', ['--image', image, '--publish'], undefined, docker)).toBe(1);
  expect(output.writeError).toHaveBeenCalledWith(expect.stringContaining('requires --cli-tarball'));
  expect(docker).not.toHaveBeenCalled();
});

it('builds a local CLI image from its tarball without npm registry lookup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cli-test-'));
  try {
    const tarball = join(directory, 'cli.tgz');
    await writeFile(tarball, 'local artifact');
    let generatedDockerfile = '';
    const docker = vi.fn(async (args: string[]) => {
      if (args[0] === 'build' && args[args.indexOf('--tag') + 1] === image)
        generatedDockerfile = await readFile(args[args.indexOf('--file') + 1]!, 'utf8');
      return args[0] === 'run' ? '0.0.19-local.0' : '';
    });
    const resolve = vi.fn(async () => `${image.slice(0, image.lastIndexOf(':'))}@sha256:${'a'.repeat(64)}`);
    expect(await automationRuntimeImage(terminal(), '0.0.19-local.0',
      ['--image', image, '--cli-tarball', tarball, '--publish'], undefined, docker, resolve)).toBe(0);
    expect(generatedDockerfile).toContain('COPY cli.tgz /tmp/inheriti-cli.tgz');
    expect(generatedDockerfile).not.toContain('@safetech/inheriti-cli@');
    expect(docker.mock.calls.map(([args]) => args[0])).toEqual(['build', 'image', 'build', 'run', 'push', 'image']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('does not push when the final application image cannot install the CLI', async () => {
  let builds = 0;
  const docker = vi.fn(async (args: string[]) => {
    if (args[0] === 'build' && ++builds === 2) throw new Error('npm missing');
    return '';
  });
  await expect(automationRuntimeImage(terminal(), '0.0.19-dev.0', ['--image', image, '--publish'], undefined, docker))
    .rejects.toThrow('final stage needs npm');
  expect(docker.mock.calls.map(([args]) => args[0])).toEqual(['build', 'image', 'build', 'image']);
});
