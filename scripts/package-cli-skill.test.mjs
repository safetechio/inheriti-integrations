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
