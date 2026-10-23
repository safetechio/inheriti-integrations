import { describe, expect, it } from 'vitest';
import { generateAutomationRuntimeBundle } from '../src/automation-runtime-setup.js';
import type { AutomationConnection } from '../src/automation-setup.js';

const planId = '485384e3-b685-4142-b1ca-95a0b90e56ba';
const connectionId = '97d5493c-6e86-44a7-9079-df7a447624fa';
const base = { planId, selector: 'sample.password', envName: 'APP_SECRET' };
const connection = (provider: AutomationConnection['provider'], trust: AutomationConnection['trust']): AutomationConnection =>
  ({ id: connectionId, name: 'Deploy', provider, environment: 'TEST', status: 'VERIFIED', trust });

describe('automation runtime bundle', () => {
  it('generates a Cloud Run entry point with the exact audience and runtime command passthrough', () => {
    const audience = `https://example.test/automation/${connectionId}`;
    const bundle = generateAutomationRuntimeBundle({ ...base, connection: connection('GOOGLE_CLOUD', { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience, serviceAccountSubject: '123456789' }) });
    expect(bundle.target).toBe('Cloud Run workload');
    expect(bundle.instructions.join(' ')).toContain('service or job');
    expect(bundle.environment).toEqual({ INHERITI_AUTOMATION_PROVIDER: 'GOOGLE_CLOUD', INHERITI_AUTOMATION_CONNECTION_ID: connectionId, INHERITI_AUTOMATION_AUDIENCE: audience });
    expect(bundle.script).toContain(`export INHERITI_AUTOMATION_AUDIENCE='${audience}'`);
    expect(bundle.script).toContain(`'secrets' 'exec' '${planId}' '--automation' '--env' 'APP_SECRET=sample.password' '--' "$@"`);
    expect(bundle.script).not.toContain('123456789');
  });

  it('passes several mapped fields to one child process without embedding their values', () => {
    const bundle = generateAutomationRuntimeBundle({ planId, connection: connection('GOOGLE_CLOUD', {
      method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC',
      audience: `https://example.test/automation/${connectionId}`, serviceAccountSubject: '123456789',
    }), mappings: [
      { selector: 'sample.username', envName: 'APP_USER' },
      { selector: 'sample.password', envName: 'APP_SECRET' },
    ] });
    expect(bundle.script).toContain("'--env' 'APP_USER=sample.username' '--env' 'APP_SECRET=sample.password' '--' \"$@\"");
    expect(() => generateAutomationRuntimeBundle({ planId, connection: connection('AWS', {
      method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/deploy',
    }), mappings: [
      { selector: 'sample.username', envName: 'APP_USER' },
      { selector: 'sample.password', envName: 'APP_USER' },
    ] })).toThrow('automation_runtime_input_invalid');
  });

  it('generates an ECS entry point and requires region without inventing it', () => {
    const bundle = generateAutomationRuntimeBundle({ ...base, connection: connection('AWS', { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/deploy' }) });
    expect(bundle.target).toBe('ECS task');
    expect(bundle.requiredEnvironment).toEqual(['AWS_REGION or AWS_DEFAULT_REGION']);
    expect(bundle.environment).not.toHaveProperty('AWS_REGION');
    expect(bundle.script).toContain("export INHERITI_AUTOMATION_PROVIDER='AWS'");
    expect(bundle.script).toContain(`export INHERITI_AUTOMATION_CONNECTION_ID='${connectionId}'`);
    expect(bundle.instructions.join(' ')).toContain('taskRoleArn');
  });

  it('generates a custom runner entry point without a private key', () => {
    const bundle = generateAutomationRuntimeBundle({ ...base, connection: connection('PORTABLE', { method: 'PORTABLE_SIGNED_ASSERTION', keyId: 'key-1', publicKey: 'public-key', runnerSubject: 'runner-1', environment: 'test' }) });
    expect(bundle.target).toBe('Custom runner');
    expect(bundle.requiredEnvironment).toEqual(['INHERITI_AUTOMATION_PRIVATE_KEY_FILE']);
    expect(bundle.environment).toMatchObject({ INHERITI_AUTOMATION_KEY_ID: 'key-1', INHERITI_AUTOMATION_RUNNER_SUBJECT: 'runner-1', INHERITI_AUTOMATION_ENVIRONMENT: 'test' });
    expect(JSON.stringify(bundle)).not.toContain('public-key');
  });

  it('rejects untrusted identifiers, mappings, and mismatched trust', () => {
    const valid = connection('AWS', { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/deploy' });
    for (const invalid of [
      { planId: '$(bad)' }, { selector: 'sample.password; echo leak' }, { envName: 'APP_SECRET; echo leak' },
      { envName: 'INHERITI_AUTOMATION_PROVIDER' },
    ]) expect(() => generateAutomationRuntimeBundle({ ...base, connection: valid, ...invalid })).toThrow();
    expect(() => generateAutomationRuntimeBundle({ ...base, connection: connection('AWS', { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience: 'x', serviceAccountSubject: '1' }) })).toThrow();
  });
});
