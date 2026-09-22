import assert from 'node:assert/strict';
import test from 'node:test';
import { packageVersionForDeployment, requiredBuildDeployment } from './build-deployment.mjs';

test('requires every distributable build to select its deployment', () => {
  assert.throws(() => requiredBuildDeployment([], {}), /requires INHERITI_BUILD_DEPLOYMENT/);
  assert.equal(requiredBuildDeployment(['--deployment=stg'], {}), 'stg');
});

test('derives an immutable npm version for each deployment', () => {
  assert.equal(packageVersionForDeployment('1.2.3', 'dev'), '1.2.3-dev.0');
  assert.equal(packageVersionForDeployment('1.2.3', 'stg'), '1.2.3-stg.0');
  assert.equal(packageVersionForDeployment('1.2.3', 'prod'), '1.2.3');
  assert.throws(() => packageVersionForDeployment('1.2.3-dev.0', 'dev'), /Invalid base/);
});
