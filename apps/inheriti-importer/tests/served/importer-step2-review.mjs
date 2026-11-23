// Run against the local Importer renderer and Business harness with real SafeID sign-in.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from '../../scripts/review-local.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(
  resolve(appRoot, '../../../../business/inheriti-business-ui/package.json'),
);
const { _electron } = require('playwright');
const fixtureRoot = join(appRoot, 'tests/fixtures/sample-imports/realistic');
const manifest = JSON.parse(await readFile(join(fixtureRoot, 'manifest.json'), 'utf8'));
assert.equal(manifest.synthetic, true);
const sources = [];
for (const name of ['onepassword-rich.1pux', 'passbolt-compatible.json']) {
  const { sha256, expectedEntries } = manifest.files[name];
  assert.equal(
    createHash('sha256')
      .update(await readFile(join(fixtureRoot, name)))
      .digest('hex'),
    sha256,
  );
  sources.push({ name, sha256, expectedEntries });
}

const apiOrigin = 'http://business.localhost:3400';
const localConfig = Object.fromEntries(
  (await readFile(join(appRoot, '.env.local'), 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(INHERITI_API_ORIGIN|SAFEID_URL|SAFEID_REALM)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]),
);
assert.equal(localConfig.INHERITI_API_ORIGIN, apiOrigin);
assert.ok(localConfig.SAFEID_URL && localConfig.SAFEID_REALM);
for (const url of ['http://127.0.0.1:5173', apiOrigin + '/health-check']) {
  assert.ok(
    (await fetch(url, { signal: AbortSignal.timeout(5000) })).ok,
    'Start the local Importer and Business harness.',
  );
}

const output = await mkdtemp(join(tmpdir(), 'importer-step2-review-'));
const profile = await mkdtemp(join(tmpdir(), 'importer-step2-electron-'));
// Native notes intentionally disable template mappings, so this companion fixture has none.
const mappingFixture = 'passbolt-mapping-pair.json';
const mappingInput = JSON.stringify({
  resources: ['Mapping template', 'Mapping target'].map((name, index) => ({
    name,
    username: `fixture-user-${index}`,
    secret: `fixture-password-${index}`,
    backup_code: `fixture-backup-${index}`,
  })),
});
sources.push({
  name: mappingFixture,
  sha256: createHash('sha256').update(mappingInput).digest('hex'),
  expectedEntries: 2,
});
const summary = {
  lane: 'authenticated local Electron',
  sources,
  checks: [],
  failures: [],
  blockedWriteRequests: 0,
};
let app;
let page;
let step = 'launch';
const dispatch = 'Dispatch console — São Paulo / 出荷';
const heading = (name) => page.getByRole('heading', { name, exact: true });
const dialog = (name) => page.getByRole('dialog', { name, exact: typeof name === 'string' });
const sourceFilter = () => page.getByRole('combobox', { name: 'Filter by source' });
const inspector = () => page.locator('.asset-review-inspector');
const title = () => inspector().locator('.asset-inspector-heading-text').first();
const reviewTab = (name) =>
  page
    .locator('.asset-review-surface')
    .getByRole('button', {
      name: new RegExp(`^${name}\\s*\\d+$`),
    })
    .first();
async function check(label, run) {
  step = label;
  try {
    await run();
    summary.checks.push(label);
    console.log(`Passed ${label}`);
  } catch (error) {
    summary.failures.push({ check: label, kind: error.name });
    console.error(`Failed ${label} (${error.name})`);
    for (const dismiss of await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Close / })
      .all()) {
      if (await dismiss.isVisible()) await dismiss.click({ timeout: 1000 }).catch(() => {});
    }
    await page.keyboard.press('Escape');
    process.exitCode = 1;
  }
}
async function screenshot(name, { diagnosticOnly = false } = {}) {
  await page.screenshot({
    path: join(output, `${name}.png`),
    mask: [
      inspector(),
      button(/^Open account menu/),
      button(/^Change organisation/),
      ...(diagnosticOnly ? [] : [page.getByRole('dialog')]),
    ],
    maskColor: '#d1d5db',
  });
}
async function assertEnabled(control, enabled) {
  await control.waitFor();
  assert.equal(await control.isEnabled(), enabled);
}
async function openCoverage(filter) {
  await button('View source field details').click();
  const coverage = dialog('Source field details');
  await button(`Show ${filter} fields`, coverage).click();
  return coverage;
}
const button = (name, scope = page) =>
  scope.getByRole('button', { name, exact: typeof name === 'string' });

async function counter(control) {
  const count = (await control.textContent()).match(/\d+$/);
  assert.ok(count, 'Review counter is missing.');
  return Number(count[0]);
}
async function reviewCounts() {
  const assets = {};
  for (const status of ['All', 'To review', 'Accepted', 'Excluded']) {
    assets[status] = await counter(reviewTab(status));
  }
  assert.equal(assets.All, assets['To review'] + assets.Accepted + assets.Excluded);
  const coverage = await openCoverage('All');
  const fields = {};
  for (const status of ['All', 'Unassigned', 'Proposed', 'Invalid', 'Excluded', 'Mapped']) {
    fields[status] = await counter(button(`Show ${status} fields`, coverage));
  }
  await button('Close Source field details', coverage).click();
  const fieldCount =
    fields.Unassigned + fields.Proposed + fields.Invalid + fields.Excluded + fields.Mapped;
  // The All tab also includes parser diagnostics alongside source fields.
  assert.ok(fields.All > fieldCount);
  return { assets, fields, fieldCount, diagnosticRows: fields.All - fieldCount };
}

try {
  app = await _electron.launch({
    executablePath: join(appRoot, 'node_modules/.bin/electron'),
    args: [appRoot, '--no-sandbox', '--disable-gpu'],
    cwd: appRoot,
    env: { ...process.env, ...localConfig, XDG_CONFIG_HOME: profile, INHERITI_ENV: 'local' },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  step = 'authenticate';
  await authenticate(app, page, output, { captureFailure: false });
  summary.checks.push(step);
  console.log('Authenticated local Electron');
  await app.evaluate(({ net }, origin) => {
    const request = net.request;
    globalThis.step2WriteAttempts = 0;
    net.request = function (options, ...args) {
      const url = typeof options === 'string' ? options : options.url;
      const method = typeof options === 'string' ? 'GET' : (options.method ?? 'GET');
      if (url && new URL(url).origin === origin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        globalThis.step2WriteAttempts++;
        throw new Error('Business writes are blocked in the Step 2 review lane.');
      }
      return request.call(this, options, ...args);
    };
  }, apiOrigin);
  step = 'parse real fixtures';
  await writeFile(join(profile, mappingFixture), mappingInput, { mode: 0o600 });
  await app.evaluate(
    ({ dialog }, filePaths) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
      globalThis.restoreStep2Picker = () => {
        dialog.showOpenDialog = original;
      };
    },
    sources.map(({ name }) => join(name === mappingFixture ? profile : fixtureRoot, name)),
  );
  await button('Choose files').click();
  for (const { name, expectedEntries } of sources) {
    await page.getByText(name, { exact: true }).waitFor();
    await page.getByText(`${expectedEntries} entries`, { exact: true }).waitFor();
  }
  await app.evaluate(() => globalThis.restoreStep2Picker());
  await button('Continue').click();
  const warning = page.getByRole('dialog', { name: 'Some source content won’t be imported' });
  if (await warning.isVisible()) await button('Continue import', warning).click();
  await page.getByText('Review detected assets', { exact: true }).waitFor();
  const guide = dialog(/^Quick guide/);
  if (await guide.isVisible()) {
    await button('Skip', guide).click();
    await guide.waitFor({ state: 'hidden' });
  }
  summary.checks.push(step);
  await check('source, status, and issue counters', async () => {
    const total = sources.reduce((sum, source) => sum + source.expectedEntries, 0);
    await reviewTab('To review').waitFor();
    await heading(`Assets (${total})`).waitFor();
    summary.initialCounts = await reviewCounts();
    assert.equal(summary.initialCounts.assets.All, total);
    assert.equal(summary.initialCounts.assets['To review'], total);
    await assertEnabled(button('Continue'), false);
    await assertEnabled(button('Focus next issue'), true);
    await button('Focus next issue').click();
    const nextIssue = dialog(/ — Issues$/);
    await nextIssue.waitFor();
    assert.equal(
      await nextIssue.getAttribute('aria-label'),
      `${await title().textContent()} — Issues`,
    );
    await page.keyboard.press('Escape');
    await nextIssue.waitFor({ state: 'hidden' });
    for (const { name, expectedEntries } of sources) {
      await sourceFilter().selectOption({ label: name });
      await heading(`Assets (${expectedEntries})`).waitFor();
    }
    await sourceFilter().selectOption({ label: sources[1].name });
    const exceptions = page.getByRole('combobox', {
      name: 'Filter by exception',
      includeHidden: true,
    });
    const counters = await exceptions.locator('option').allTextContents();
    const counts = Object.fromEntries(
      counters.flatMap((label) => {
        const match = label.match(/^(.*) \((\d+)\)$/);
        return match ? [[match[1], Number(match[2])]] : [];
      }),
    );
    assert.deepEqual(Object.keys(counts), ['Invalid', 'Missing mappings', 'Unmapped fields']);
    const [exception, count] = Object.entries(counts).find(([, n]) => n > 0);
    const chip = button(new RegExp(`^${exception}\\s*${count}$`));
    if (await exceptions.isVisible())
      await exceptions.selectOption({ label: `${exception} (${count})` });
    else await chip.click();
    await heading(`Assets (${count})`).waitFor();
    if (await exceptions.isVisible()) await exceptions.selectOption('');
    else await chip.click();
    summary.passboltExceptions = counts;
    await sourceFilter().selectOption({ label: sources[0].name });
    await screenshot('01-review');
  });

  await check('warning details', async () => {
    await button('Inspect Billing approval login and attachment').click();
    await button('View asset issues', inspector()).click();
    const issues = dialog(/Billing approval login and attachment —/);
    const warnings = issues.getByRole('button', { name: /^Warnings/ });
    await warnings.click();
    const warning = issues
      .getByText('Item file content was skipped.', { exact: true })
      .locator('..');
    await button('View details (1)', warning).click();
    await warning.getByText('1 occurrence', { exact: true }).waitFor();
    await screenshot('02-warnings', { diagnosticOnly: true });
    await button('Hide details', warning).click();
    await issues.getByRole('button', { name: /^Fields to resolve/ }).click();
    await page.keyboard.press('Escape');
    await issues.waitFor({ state: 'hidden' });
  });

  await check('asset name Enter, blur, Escape and validation', async () => {
    await button(`Inspect ${dispatch}`).click();
    const input = inspector().getByRole('textbox', { name: 'Asset name' });
    for (const [name, keyboard, expected] of [
      ['Dispatch review Enter', 'Enter', 'Dispatch review Enter'],
      ['Dispatch review blur', 'Tab', 'Dispatch review blur'],
      ['Discarded draft', 'Escape', 'Dispatch review blur'],
    ]) {
      await button('Edit asset name', inspector()).click();
      await input.fill(name);
      if (keyboard === 'Tab')
        await inspector().getByRole('combobox', { name: 'Asset type' }).focus();
      else await input.press(keyboard);
      assert.equal(await title().textContent(), expected);
    }
    await button('Edit asset name', inspector()).click();
    await input.fill(' ');
    await input.press('Enter');
    await inspector().getByText('Enter an asset name.', { exact: true }).waitFor();
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    await input.press('Escape');
    await button('Edit asset name', inspector()).click();
    await input.fill(dispatch);
    await input.press('Enter');
  });

  await check('global and per-asset notes destination and companion link', async () => {
    await sourceFilter().selectOption('all');
    await button(`Inspect ${dispatch}`).click();
    const note = inspector().getByRole('radiogroup', { name: 'Notes destination for this asset' });
    assert.equal(await note.getByRole('radio', { name: 'Asset notes' }).isChecked(), true);
    await button('Notes destination').click();
    const preferences = page.getByRole('radiogroup', { name: 'Notes destination · All sources' });
    await preferences.getByText('As secret', { exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await note.getByRole('radio', { name: 'As secret' }).isChecked(), true);
    await note.getByText('Asset notes', { exact: true }).click();
    assert.equal(await note.getByRole('radio', { name: 'Asset notes' }).isChecked(), true);
    await note.getByText('As secret', { exact: true }).click();
    const companion = `${dispatch} — Notes`;
    await button(`Open ${companion}`).click();
    assert.equal(await title().textContent(), companion);
    await button(`Inspect ${dispatch}`).click();
  });

  await check('type and source mapping', async () => {
    const type = inspector().getByRole('combobox', { name: 'Asset type' });
    const original = await type.inputValue();
    const available = await type
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    assert.deepEqual(available, [
      'USER-PSWD',
      'PLAIN-TEXT',
      'RECOVERY-CODE',
      'PIN-CODE',
      'API-KEY',
      'PRIVATE-KEY',
      'SEED-PHRASE',
      'PAYMENT-CREDIT-CARD',
      'PAYMENT-DEBIT-CARD',
    ]);
    for (const value of available.filter((value) => value !== original)) {
      await type.selectOption(value);
      assert.equal(await type.inputValue(), value);
      await type.selectOption(original);
      assert.equal(await type.inputValue(), original);
    }
    summary.assetTypes = available;
    const picker = inspector()
      .locator('.asset-source-picker')
      .filter({
        has: button(/^Change.+source field$/),
      })
      .first();
    const change = button(/^Change.+source field$/, picker);
    await change.click();
    const mapped = picker.locator('.asset-source-options [aria-pressed="true"]').first();
    await mapped.waitFor();
    await mapped.press('Enter');
    await change.waitFor();
    assert.equal(await picker.locator('.asset-source-options').count(), 0);
  });

  await check('accept, exclude and restore an asset', async () => {
    const subject = 'Finance sandbox card';
    await button(`Inspect ${subject}`).click();
    const status = () => button(`Actions for ${subject}`, inspector());
    const action = (name) => page.getByRole('menuitem', { name, exact: true });
    await button('Accept', inspector()).click();
    await reviewTab('Accepted').click();
    await heading('Assets (1)').waitFor();
    await button(`Inspect ${subject}`).click();
    await status().click();
    await action('Exclude from import').click();
    await reviewTab('Excluded').click();
    await heading('Assets (1)').waitFor();
    await button('Select all').click();
    await button('Restore selected').click();
    await heading('Assets (0)').waitFor();
    await reviewTab('To review').click();
  });

  await check('preview, cancel and apply a bulk mapping', async () => {
    const template = 'Mapping template';
    const target = 'Mapping target';
    const inspect = (name) => button(`Inspect ${name}`);
    const password = () => inspector().locator('[data-review-field="secret.password"]');
    await sourceFilter().selectOption({ label: mappingFixture });
    await inspect(target).click();
    const original = await password().locator('.asset-source-field-label').textContent();
    await button('Accept', inspector()).click();
    await reviewTab('Accepted').click();
    await inspect(target).waitFor();
    await reviewTab('All').click();
    await inspect(template).click();
    await button('Change Password source field', password()).click();
    await button(/^Map Password to backup_code$/i, password()).click();
    await page.getByRole('checkbox', { name: `Select ${target}`, exact: true }).click();
    const preview = page.getByRole('group', { name: 'Confirm applying mappings', exact: true });
    const apply = button('Apply this mapping…');
    await apply.click();
    await preview.getByText(/1 of 1 selected assets will change/).waitFor();
    await button('Cancel', preview).click();
    await preview.waitFor({ state: 'hidden' });
    await inspect(target).click();
    assert.equal(await password().locator('.asset-source-field-label').textContent(), original);
    await inspect(template).click();
    await apply.click();
    await button('Confirm apply', preview).click();
    await page.getByText('1 updated · 0 skipped', { exact: true }).waitFor();
    await reviewTab('To review').click();
    await inspect(target).click();
    await password().getByText('backup_code', { exact: true }).waitFor();
    await sourceFilter().selectOption('all');
  });

  await check('assign a field to an existing asset and undo the assignment', async () => {
    await sourceFilter().selectOption('all');
    await reviewTab('To review').click();
    await button(`Inspect ${dispatch}`).click();
    const origin = dialog(new RegExp('^Dispatch console'));
    const openIssues = async () => {
      await button('View asset issues', inspector()).click();
      await origin.waitFor();
    };
    const field = (name) => origin.getByRole('checkbox', { name: `Select ${name}`, exact: true });
    await openIssues();
    const first = field('Recovery: Code');
    await first.click();
    await button(/^Create assets?$/, origin).click();
    const create = dialog(/^Create assets?$/);
    await create.getByRole('combobox', { name: 'Asset type' }).selectOption('PLAIN-TEXT');
    await create.getByRole('textbox', { name: 'Asset name' }).fill('Dispatch recovery fields');
    await assertEnabled(button('Confirm', create), false);
    await button('Use remaining fields', create).click();
    await assertEnabled(button('Confirm', create), true);
    await button('Confirm', create).click();
    await create.waitFor({ state: 'hidden' });
    await button('Inspect Dispatch recovery fields').waitFor();
    await button(`Inspect ${dispatch}`).click();
    await openIssues();
    const second = field('Recovery: Code (2)');
    await second.click();
    await button('Assign to asset', origin).click();
    const assignment = dialog('Assign fields to an asset');
    const target = assignment.getByRole('combobox', { name: 'Target asset', exact: true });
    const option = target.getByRole('option', { name: /^Dispatch recovery fields/ });
    await target.selectOption(await option.getAttribute('value'));
    await assignment.getByText('1/1 field assigned', { exact: true }).waitFor();
    await button('Confirm', assignment).click();
    await assignment.waitFor({ state: 'hidden' });
    await button('Inspect Dispatch recovery fields').click();
    await button('View asset issues', inspector()).click();
    const assigned = dialog(/^Dispatch recovery fields —/);
    await assigned.getByText('Recovery: Code (2)', { exact: true }).waitFor();
    await button(/^Close Dispatch recovery fields/, assigned).click();
    await button('Undo field changes').click();
    await page.getByText('Field operation undone.', { exact: false }).waitFor();
    await button(`Inspect ${dispatch}`).click();
    await openIssues();
    await second.waitFor();
    await page.keyboard.press('Escape');
  });

  await check('generated API key releases stale mapping when switched to Login', async () => {
    await button(`Inspect ${dispatch}`).click();
    const origin = dialog(/^Dispatch console —/);
    await button('View asset issues', inspector()).click();
    for (const name of ['Recovery: Code (2)', 'Recovery: Code (3)']) {
      await origin.getByRole('checkbox', { name: `Select ${name}`, exact: true }).click();
    }
    await button('Create assets', origin).click();
    const create = dialog(/^Create assets?$/);
    const subject = 'Dispatch generated API key';
    await create.getByRole('combobox', { name: 'Asset type' }).selectOption('API-KEY');
    await create.getByRole('textbox', { name: 'Asset name' }).fill(subject);
    const confirm = button('Confirm', create);
    await assertEnabled(confirm, false);
    await button(/^Choose API key source field$/i, create).click();
    await button(/^Map API key to Recovery: Code \(2\)$/i, create).click();
    await assertEnabled(confirm, true);
    await confirm.click();
    await create.waitFor({ state: 'hidden' });
    await button(`Inspect ${subject}`).click();
    const type = inspector().getByRole('combobox', { name: 'Asset type' });
    await button('Accept', inspector()).click();
    await reviewTab('Accepted').click();
    await button(`Inspect ${subject}`).click();
    await button(/^Change API key source field$/i, inspector()).click();
    await button(/^Map API key to Recovery: Code \(3\)$/i, inspector()).click();
    await reviewTab('To review').click();
    await button(`Inspect ${subject}`).click();
    await inspector().getByText('Recovery: Code (3)', { exact: true }).waitFor();
    await type.selectOption('USER-PSWD');
    assert.equal(await type.inputValue(), 'USER-PSWD');
    const password = button(/^(Choose|Change) Password source field$/i, inspector());
    await password.click();
    await button(/^Map Password to Recovery: Code \(3\)$/i, inspector()).waitFor();
    await button(/^Map Password to Recovery: Code \(2\)$/i, inspector()).click();
    const coverage = await openCoverage('Unassigned');
    await coverage.getByRole('checkbox', { name: /^Recovery: Code \(3\) from/ }).waitFor();
    await button('Close Source field details', coverage).click();
  });

  await check('exclude and undo a source field while preserving Accept All undo', async () => {
    await sourceFilter().selectOption('all');
    const originalAccepted = await reviewTab('Accepted').textContent();
    const accept = button(/^Accept all eligible \(/);
    await accept.click();
    const banner = page.getByRole('status').filter({ hasText: /accepted · \d+ require review/ });
    await banner.waitFor();
    assert.ok((await reviewTab('Accepted').textContent()) !== originalAccepted);
    const coverage = await openCoverage('Unassigned');
    const row = coverage.locator('[data-coverage-field-id]').first();
    const fieldName = await row.getByRole('checkbox').getAttribute('aria-label');
    const fieldId = await row.getAttribute('data-coverage-field-id');
    const fieldRow = coverage.locator(`[data-coverage-field-id=${JSON.stringify(fieldId)}]`);
    const entry = await row.locator('.importer-coverage-metadata').first().textContent();
    await row.getByRole('checkbox').click();
    await button('Exclude fields', coverage).click();
    const confirmation = dialog('Exclude 1 unresolved field?');
    await button('Confirm exclusion', confirmation).click();
    await confirmation.waitFor({ state: 'hidden' });
    await coverage.waitFor({ state: 'hidden' });
    await openCoverage('Excluded');
    const control = coverage.getByRole('checkbox', { name: fieldName, exact: true });
    // Excluded rows lose their action checkbox.
    assert.equal(await control.count(), 0);
    const excludedEntry = coverage
      .getByText(entry, { exact: true })
      .locator('../..')
      .filter({
        has: page.getByText(fieldName.split(' from ')[0], { exact: true }),
      });
    await excludedEntry.waitFor();
    await button('Show Unassigned fields', coverage).click();
    assert.equal(await fieldRow.count(), 0);
    await button('Close Source field details', coverage).click();
    await button('Undo field changes').click();
    await page.getByText('Field operation undone.', { exact: false }).waitFor();
    await openCoverage('Unassigned');
    await fieldRow.waitFor();
    await button('Close Source field details', coverage).click();
    await button('Undo', banner).click();
    assert.equal(await reviewTab('Accepted').textContent(), originalAccepted);
  });

  await check('Continue clears only after review and field blockers are resolved', async () => {
    await assertEnabled(button('Continue'), false);
    const accept = button(/^Accept all eligible \(/);
    await accept.click();
    await assertEnabled(button('Continue'), false);
    const coverage = await openCoverage('Unassigned');
    await coverage
      .getByRole('checkbox', { name: /^Select all \d+ fields in this filter$/ })
      .click();
    await button(/^Create assets?$/, coverage).click();
    const preview = dialog(/^Create assets?$/);
    await button(/^(?:Confirm|Create \d+ assets?)$/, preview).click();
    await preview.waitFor({ state: 'hidden' });
    if (await accept.isEnabled()) await accept.click();
    await assertEnabled(button('Continue'), true);
    await assertEnabled(button('Focus next issue'), false);
    await page.getByText('Review detected assets', { exact: true }).waitFor();
    summary.finalCounts = await reviewCounts();
    assert.equal(summary.finalCounts.fieldCount, summary.initialCounts.fieldCount);
    assert.equal(summary.finalCounts.diagnosticRows, summary.initialCounts.diagnosticRows);
    assert.equal(summary.finalCounts.fields.Unassigned + summary.finalCounts.fields.Invalid, 0);
    assert.equal(summary.finalCounts.assets['To review'], 0);
    summary.finalStage = 2;
    summary.continueEnabled = true;
    await screenshot('03-ready');
  });
} catch (error) {
  summary.failedStep = step;
  console.error(`Step 2 lane failed during ${step} (${error.name})`);
  process.exitCode = 1;
} finally {
  try {
    try {
      if (app && summary.checks.includes('authenticate')) {
        summary.blockedWriteRequests = await app.evaluate(() => globalThis.step2WriteAttempts);
        assert.equal(summary.blockedWriteRequests, 0);
      }
    } finally {
      await app?.close();
    }
  } catch (error) {
    summary.failures.push({ check: 'record write guard and close Electron', kind: error.name });
    process.exitCode = 1;
  } finally {
    try {
      await rm(profile, { recursive: true, force: true });
    } finally {
      await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
      console.log(`Step 2 evidence at ${output}`);
    }
  }
}
