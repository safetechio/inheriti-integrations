import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('GitHub Actions keeps human invocations and requires OIDC for automation opt-in', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inheriti-github-action-'));
  try {
    const capture = join(directory, 'args.json');
    writeFileSync(join(directory, 'npm'), `#!${process.execPath}\n` + `
const fs = require('node:fs');
fs.writeFileSync(process.env.CAPTURE, JSON.stringify({
  args: process.argv.slice(2),
  oidcUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
  oidcToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
}));
`, { mode: 0o700 });
    const baseEnv = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      CAPTURE: capture,
      INHERITI_SECRETS_PLAN: 'fixture-plan',
      INHERITI_SECRETS_ENV: 'TOKEN=service.token',
      INHERITI_SECRETS_COMMAND: './deploy.sh',
    };
    const wrapper = join(root, 'integrations/github-actions/entrypoint.sh');
    const expectedArgs = [
      'exec', '--yes', '--package=@safetech/inheriti-cli@latest', '--', 'inheriti',
      'secrets', 'exec', 'fixture-plan', '--output', 'suppress', '--env',
      'TOKEN=service.token', '--', 'bash', '-c', './deploy.sh',
    ];

    const human = spawnSync('bash', [wrapper], { env: baseEnv, encoding: 'utf8' });
    assert.equal(human.status, 0, human.stderr);
    assert.deepEqual(JSON.parse(readFileSync(capture, 'utf8')).args, expectedArgs);

    rmSync(capture);
    const missingOidcEnv = {
      ...baseEnv,
      INHERITI_AUTOMATION_CONNECTION_ID: 'connection-fixture',
      INHERITI_AUTOMATION_AUDIENCE: 'audience-fixture',
    };
    delete missingOidcEnv.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete missingOidcEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    const missingOidc = spawnSync('bash', [wrapper], { env: missingOidcEnv, encoding: 'utf8' });
    assert.notEqual(missingOidc.status, 0);
    assert.equal(existsSync(capture), false);

    const oidcEnv = {
      ...missingOidcEnv,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/request',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token-fixture',
    };
    const withOidc = spawnSync('bash', [wrapper], { env: oidcEnv, encoding: 'utf8' });
    assert.equal(withOidc.status, 0, withOidc.stderr);
    const captured = JSON.parse(readFileSync(capture, 'utf8'));
    assert.deepEqual(captured.args, [...expectedArgs.slice(0, 10), '--automation', ...expectedArgs.slice(10)]);
    assert.equal(captured.oidcUrl, oidcEnv.ACTIONS_ID_TOKEN_REQUEST_URL);
    assert.equal(captured.oidcToken, oidcEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
    assert.equal(withOidc.stdout, '');
    assert.equal(withOidc.stderr.includes(oidcEnv.ACTIONS_ID_TOKEN_REQUEST_URL), false);
    assert.equal(withOidc.stderr.includes(oidcEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Google wrappers opt in to automation only with connection configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inheriti-google-wrapper-'));
  try {
    const capture = join(directory, 'args.json');
    writeFileSync(join(directory, 'inheriti'), `#!${process.execPath}\n` + `
require('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify({
  args: process.argv.slice(2), provider: process.env.INHERITI_AUTOMATION_PROVIDER,
}));
`, { mode: 0o700 });
    const env = {
      ...process.env, PATH: `${directory}:${process.env.PATH}`, CAPTURE: capture,
      INHERITI_SECRETS_PLAN: 'fixture-plan', INHERITI_SECRETS_ENV: 'TOKEN=service.token',
    };
    delete env.INHERITI_AUTOMATION_PROVIDER;
    delete env.INHERITI_AUTOMATION_CONNECTION_ID;
    delete env.INHERITI_AUTOMATION_AUDIENCE;
    for (const wrapper of ['cloud-run/entrypoint.sh', 'gke/entrypoint.sh', 'compute-engine/startup.sh']) {
      const script = join(root, 'integrations/google-cloud', wrapper);
      const human = spawnSync('bash', [script, './deploy.sh'], { env, encoding: 'utf8' });
      assert.equal(human.status, 0, human.stderr);
      assert.equal(JSON.parse(readFileSync(capture, 'utf8')).args.includes('--automation'), false);
      rmSync(capture);

      const partial = spawnSync('bash', [script, './deploy.sh'], {
        env: { ...env, INHERITI_AUTOMATION_CONNECTION_ID: 'connection-fixture' }, encoding: 'utf8',
      });
      assert.notEqual(partial.status, 0);
      assert.equal(existsSync(capture), false);

      const automated = spawnSync('bash', [script, './deploy.sh'], {
        env: { ...env, INHERITI_AUTOMATION_CONNECTION_ID: 'connection-fixture', INHERITI_AUTOMATION_AUDIENCE: 'https://business.example/connection-fixture' },
        encoding: 'utf8',
      });
      assert.equal(automated.status, 0, automated.stderr);
      const captured = JSON.parse(readFileSync(capture, 'utf8'));
      assert.equal(captured.provider, 'GOOGLE_CLOUD');
      assert.equal(captured.args.includes('--automation'), true);
      rmSync(capture);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AWS wrappers opt in to automation only with connection and region', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inheriti-aws-wrapper-'));
  try {
    const capture = join(directory, 'args.json');
    writeFileSync(join(directory, 'inheriti'), `#!${process.execPath}\n` + `
require('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify({
  args: process.argv.slice(2), provider: process.env.INHERITI_AUTOMATION_PROVIDER,
}));
`, { mode: 0o700 });
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, CAPTURE: capture,
      INHERITI_SECRETS_PLAN: 'fixture-plan', INHERITI_SECRETS_ENV: 'TOKEN=service.token' };
    delete env.INHERITI_AUTOMATION_PROVIDER;
    delete env.INHERITI_AUTOMATION_CONNECTION_ID;
    delete env.AWS_REGION;
    delete env.AWS_DEFAULT_REGION;
    for (const wrapper of ['ecs/entrypoint.sh', 'ec2-ssm/run-command.sh']) {
      const script = join(root, 'integrations/aws', wrapper);
      const human = spawnSync('bash', [script, './deploy.sh'], { env, encoding: 'utf8' });
      assert.equal(human.status, 0, human.stderr);
      assert.equal(JSON.parse(readFileSync(capture, 'utf8')).args.includes('--automation'), false);
      rmSync(capture);
      const partial = spawnSync('bash', [script, './deploy.sh'], {
        env: { ...env, INHERITI_AUTOMATION_CONNECTION_ID: 'connection-fixture' }, encoding: 'utf8',
      });
      assert.notEqual(partial.status, 0);
      assert.equal(existsSync(capture), false);
      const automated = spawnSync('bash', [script, './deploy.sh'], {
        env: { ...env, INHERITI_AUTOMATION_CONNECTION_ID: 'connection-fixture', AWS_REGION: 'us-east-1' }, encoding: 'utf8',
      });
      assert.equal(automated.status, 0, automated.stderr);
      const args = JSON.parse(readFileSync(capture, 'utf8'));
      assert.equal(args.provider, 'AWS');
      assert.equal(args.args.includes('--automation'), true);
      rmSync(capture);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
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
