import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packager = join(dirname(fileURLToPath(import.meta.url)), 'package-cli.mjs');

test('rejects a symlinked SKILL.md without changing its external target', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'inheriti-cli-skill-pack-'));
  try {
    const dist = join(root, 'dist');
    const skill = join(root, 'skill', 'inheriti-cli');
    mkdirSync(dist, { recursive: true });
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(dist, 'build-deployment.json'), '{"deployment":"dev"}\n');
    writeFileSync(join(root, 'package.json'), '{"name":"@safetech/inheriti-cli","version":"0.0.20"}\n');
    const external = join(root, 'outside.md');
    const original = 'external document must remain unchanged\n';
    writeFileSync(external, original);
    try { symlinkSync(external, join(skill, 'SKILL.md'), 'file'); }
    catch (error) { if (error.code === 'EPERM') { t.skip('symlinks unavailable'); return; } throw error; }
    const result = spawnSync(process.execPath, [packager, '--deployment=dev'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsafe CLI skill file type/);
    assert.equal(readFileSync(external, 'utf8'), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('installs desktop CLI builds side by side in one npm prefix', () => {
  const root = mkdtempSync(join(tmpdir(), 'inheriti-cli-side-by-side-'));
  try {
    const dist = join(root, 'dist');
    const skill = join(root, 'skill', 'inheriti-cli');
    const xsel = join(root, 'node_modules', 'clipboardy', 'fallbacks', 'linux');
    mkdirSync(dist, { recursive: true });
    mkdirSync(skill, { recursive: true });
    mkdirSync(xsel, { recursive: true });
    writeFileSync(join(xsel, 'xsel'), '');
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: inheriti-cli\ndescription: Example\n---\nUse inheriti help.\n');
    writeFileSync(join(dist, 'main.js'), '#!/usr/bin/env node\nimport { readFileSync } from "node:fs";\nif (process.argv[2] === "version") console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version);\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: '@safetech/inheriti-cli', version: '1.2.3', type: 'module', bin: { inheriti: 'dist/main.js' }, dependencies: {},
    }));
    const windows = process.platform === 'win32';
    const command = (executable, args) => {
      const shim = windows && executable.endsWith('.cmd');
      const quote = (argument) => `"${argument}"`;
      const result = spawnSync(shim ? quote(executable) : executable, shim ? args.map(quote) : args,
        { cwd: root, encoding: 'utf8', shell: shim });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const artifacts = join(root, 'artifacts');
    const prefix = join(root, 'global');
    const packages = [
      ['dev', ['--side-by-side'], 'inheriti-dev', 'safetech-inheriti-cli-dev-1.2.3-dev.0.tgz', '1.2.3-dev.0'],
      ['stg', ['--side-by-side'], 'inheriti-stg', 'safetech-inheriti-cli-stg-1.2.3-stg.0.tgz', '1.2.3-stg.0'],
      ['prod', ['--side-by-side'], 'inheriti', 'safetech-inheriti-cli-1.2.3.tgz', '1.2.3'],
      ['dev', [], 'inheriti', 'safetech-inheriti-cli-1.2.3-dev.0.tgz', '1.2.3-dev.0'],
    ];
    for (const [deployment, flags, , tarball] of packages) {
      writeFileSync(join(dist, 'build-deployment.json'), JSON.stringify({ deployment }));
      assert.equal(command(process.execPath, [packager, `--deployment=${deployment}`, ...flags]).split(/\r?\n/u).at(-1), tarball);
    }
    const sideBySide = packages.slice(0, 3);
    const npmArgs = ['install', '--global', '--offline', '--prefix', prefix,
      ...sideBySide.map(([, , , tarball]) => join(artifacts, tarball))];
    if (windows) command(process.execPath, [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...npmArgs]);
    else command('npm', npmArgs);
    const binaries = windows ? prefix : join(prefix, 'bin');
    for (const [, , bin, , version] of sideBySide)
      assert.equal(command(join(binaries, windows ? `${bin}.cmd` : bin), ['version']), version);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
