import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wrappers = [
  'runtime/exec.sh', 'aws/ec2-ssm/run-command.sh', 'aws/ecs/entrypoint.sh',
  'google-cloud/compute-engine/startup.sh', 'google-cloud/cloud-run/entrypoint.sh',
  'google-cloud/gke/entrypoint.sh', 'github-actions/entrypoint.sh',
];

test('runtime and platform wrappers forward suppressed defaults, explicit inheritance and failures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inheriti-wrapper-'));
  try {
    const capture = join(directory, 'args.json');
    writeFileSync(join(directory, 'inheriti'), `#!${process.execPath}\n` + `
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.CAPTURE, JSON.stringify(args));
const output = args[args.indexOf('--output') + 1];
const child = spawnSync(process.execPath, ['-e', 'console.log("fixture-secret"); console.error("fixture-secret"); process.exit(7)'], { stdio: output === 'inherit' ? 'inherit' : 'ignore' });
process.exit(child.status);
`, { mode: 0o700 });
    writeFileSync(join(directory, 'npm'), '#!/usr/bin/env bash\nwhile [[ "$1" != "--" ]]; do shift; done\nshift\nexec "$@"\n', { mode: 0o700 });
    const env = Object.assign({}, process.env, {
      PATH: `${directory}:${process.env.PATH}`, CAPTURE: capture,
      INHERITI_SECRETS_PLAN: 'fixture-plan',
      INHERITI_SECRETS_ENV: 'PASSWORD=database.password\n\nTOKEN=service.token',
      INHERITI_SECRETS_COMMAND: './deploy.sh "two words"',
    });
    delete env.INHERITI_SECRETS_OUTPUT;
    for (const wrapper of wrappers) {
      for (const mode of ['suppress', 'inherit']) {
        if (mode === 'inherit') env.INHERITI_SECRETS_OUTPUT = mode;
        if (mode === 'suppress') delete env.INHERITI_SECRETS_OUTPUT;
        const result = spawnSync('bash', [join(root, 'integrations', wrapper), './deploy.sh', 'two words'], { env, encoding: 'utf8' });
        assert.equal(result.status, 7, wrapper);
        const args = JSON.parse(readFileSync(capture, 'utf8'));
        const expected = ['secrets', 'exec', 'fixture-plan', '--output', mode, '--env', 'PASSWORD=database.password', '--env', 'TOKEN=service.token', '--'];
        const command = wrapper.startsWith('github-actions/') ? ['bash', '-c', env.INHERITI_SECRETS_COMMAND] : ['./deploy.sh', 'two words'];
        assert.deepEqual(args, expected.concat(command), wrapper);
        if (mode === 'suppress') {
          assert.equal(result.stdout, '', wrapper);
          assert.equal(result.stderr, '', wrapper);
          continue;
        }
        assert.equal(result.stdout, 'fixture-secret\n', wrapper);
        assert.equal(result.stderr, 'fixture-secret\n', wrapper);
      }
    }
    const action = readFileSync(join(root, 'integrations/github-actions/action.yml'), 'utf8');
    assert.match(action, /  output:\n(?:(?!  [\w-]+:)[^\n]*\n)*    default: suppress\n/);
    assert.match(action, /INHERITI_SECRETS_OUTPUT: \$\{\{ inputs\.output \}\}/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Ansible acknowledges plaintext and suppresses secret-bearing exception chains', () => {
  const check = String.raw`
import importlib.util, subprocess, sys, traceback, types
from unittest.mock import patch
class AnsibleError(Exception): pass
for name in ['ansible', 'ansible.errors', 'ansible.plugins', 'ansible.plugins.lookup']:
    sys.modules[name] = types.ModuleType(name)
sys.modules['ansible.errors'].AnsibleError = AnsibleError
sys.modules['ansible.plugins.lookup'].LookupBase = object
spec = importlib.util.spec_from_file_location('inheriti_lookup', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
lookup = module.LookupModule()
with patch.object(subprocess, 'check_output', return_value='fixture-secret\r\n\n') as call:
    assert lookup.run(['database.password'], plan='fixture-plan') == ['fixture-secret']
    call.assert_called_once_with(['inheriti', 'secrets', 'resolve', 'fixture-plan', '--field', 'database.password', '--allow-plaintext-output'], text=True, stderr=subprocess.PIPE)
for failure in [OSError('fixture-secret'), subprocess.CalledProcessError(1, ['fixture-secret'], output='fixture-secret', stderr='fixture-secret')]:
    with patch.object(subprocess, 'check_output', side_effect=failure):
        try:
            lookup.run(['fixture-secret'], plan='fixture-plan')
            raise AssertionError('expected failure')
        except AnsibleError as error:
            assert str(error) == 'Inheriti could not resolve the requested field'
            assert error.__cause__ is None and error.__suppress_context__
            assert 'fixture-secret' not in ''.join(traceback.format_exception(error))
`;
  const result = spawnSync('python3', ['-c', check, join(root, 'integrations/ansible/lookup_plugins/inheriti.py')], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const readme = readFileSync(join(root, 'integrations/ansible/README.md'), 'utf8');
  assert.match(readme, /- name: Deploy application\n    no_log: true\n/);
});
