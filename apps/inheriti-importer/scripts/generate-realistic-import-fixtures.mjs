import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { parseAllDocuments, stringify } from 'yaml';

const output = new URL('../tests/fixtures/sample-imports/realistic/', import.meta.url);
const check = process.argv.includes('--check');
const files = {};
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const b64 = (value) => Buffer.from(value).toString('base64');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const times = (count, make) => Array.from({ length: count }, (_, index) => make(index + 1));
const yamlDocs = (objects) => objects.map((value) => '---\n' + stringify(value)).join('');
const uuid = (i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
const timestamp = 1761955200;
const marker = (i, purpose) => `SYNTHETIC-FIXTURE-${purpose}-${String(i).padStart(4, '0')}`;
const host = (service) => `${service}.example.invalid`;
const endpoint = (service) => `https://${host(service)}`;
const services = ['dispatch', 'billing', 'routing', 'inventory', 'support', 'nightly-backup'];
const serviceAt = (i) => services[(i - 1) % services.length];
const fakePem =
  '-----BEGIN SYNTHETIC TEST MARKER-----\nNOT VALID PRIVATE KEY DATA\n-----END SYNTHETIC TEST MARKER-----\n';

async function emit(name, content, metadata) {
  const bytes = Buffer.from(content);
  const target = new URL(name, output);
  if (check) {
    assert.deepEqual(await readFile(target), bytes, name + ' differs from generated output');
  } else {
    await mkdir(dirname(fileURLToPath(target)), { recursive: true });
    await writeFile(target, bytes);
  }
  if (metadata) files[name] = { ...metadata, bytes: bytes.length, sha256: sha256(bytes) };
}

function field(title, id, value, traits = {}) {
  return { title, id, value, ...traits };
}

function section(title, name, fields) {
  return { title, name, fields };
}

function item(i, title, categoryUuid, details, overview = {}, state = 'active') {
  return {
    uuid: uuid(i),
    favIndex: i % 7 === 0 ? 1 : 0,
    createdAt: timestamp - i * 120,
    updatedAt: timestamp - i * 30,
    state,
    categoryUuid,
    overview: { title, ...overview },
    details,
  };
}

function login(i, title, service, details = {}) {
  const username = `operator-${i}@${host(service)}`;
  const url = endpoint(service) + '/signin';
  return item(
    i,
    title,
    '001',
    {
      loginFields: [
        { id: 'user', value: username, name: 'email', fieldType: 'E', designation: 'username' },
        {
          id: 'pass',
          value: marker(i, 'PASSWORD'),
          name: 'password',
          fieldType: 'P',
          designation: 'password',
        },
        { id: 'tenant', value: `fixture-tenant-${i % 11}`, name: 'tenant', fieldType: 'T' },
      ],
      notesPlain: `## ${title}\nOwner: service operations.\nRotate after the sandbox acceptance run.\n`,
      sections: [
        section('Operations', 'ops', [
          field('Rotation ticket', 'ticket', { string: `FIXTURE-${100 + i}` }),
          field('Owner', 'owner', { email: `operations@${host(service)}` }),
        ]),
      ],
      ...details,
    },
    { subtitle: username, url, urls: [{ label: 'Sign-in', url }], tags: ['fixture', service] },
  );
}

const exactPassword = '  SYNTHETIC-FIXTURE-PASSWORD-0001\t#é\u00a0 ';
const richLogin = login(1, 'Dispatch console — São Paulo / 出荷', 'dispatch');
richLogin.details.loginFields[1].value = exactPassword;
richLogin.details.notesPlain =
  '# Turno de São Paulo 🚚\r\n\r\nKeep these lines.\n  Keep indentation.\n\n最後の行\n';
richLogin.overview.urls.push(
  { label: 'Recovery', url: endpoint('recovery.dispatch') + '/access?from=fixture' },
  { label: 'Recovery', url: endpoint('backup.dispatch') + '/access#fixture' },
);
richLogin.details.sections.push(
  section('Recovery', 'recovery-main', [
    field('Code', 'main-code', { concealed: marker(1, 'RECOVERY-MAIN') }),
    field('Code', 'spare-code', { concealed: marker(1, 'RECOVERY-SPARE') }),
    field('PIN', 'pin', { concealed: '0000' }),
    field('TOTP', 'otp', { otp: 'otpauth://totp/SyntheticFixture?secret=INVALID-TEST-ONLY' }),
  ]),
  section('Recovery', 'recovery-backup', [
    field('Code', 'backup-code', { concealed: marker(1, 'RECOVERY-BACKUP') }),
    field('מפתח 🔐', 'unicode', { string: '復旧手順\nLinha dois\tτελικό' }, { multiline: true }),
  ]),
  section('Fixture types', 'fixture-types', [
    field('Retry count', 'retry', 0),
    field('Enabled', 'enabled', false),
    field('Optional alias', 'empty', { string: '' }),
    field('Nested labels', 'labels', {
      fixtureArray: [
        ['warehouse', 'dispatch'],
        [0, false],
      ],
    }),
    field('Empty object', 'unknown-empty', { fixtureFuture: {} }),
    field('Address', 'address', {
      address: {
        street: '0 Placeholder Walk\nUnit 4',
        city: 'Ciudad Ficticia',
        state: 'Fixture Province',
        zip: '00000',
        country: 'ZZ',
      },
    }),
  ]),
);
richLogin.details.passwordHistory = [
  { value: marker(1, 'OLD-PASSWORD'), time: timestamp - 3600 },
  { value: marker(2, 'OLD-PASSWORD'), time: timestamp - 7200 },
];
richLogin.overview.futureBadge = { enabled: false, rank: 0 };
richLogin.details.futureMetadata = { version: 7, payload: [false, 0, 'unknown-fixture-property'] };

const document = {
  fileName: 'fixture-shift-handoff.txt',
  documentId: uuid(5001),
  content:
    'Synthetic shift handoff for fixture testing.\nThe dispatch rehearsal concluded at 18:00.\n',
};
const pdfLike = {
  fileName: 'fixture-approval.pdf',
  documentId: uuid(5002),
  content: '%PDF-1.4\n% Inert synthetic attachment marker.\n%%EOF\n',
};

function attach(entry, { fileName, documentId, content }) {
  entry.details.documentAttributes = {
    fileName,
    documentId,
    decryptedSize: Buffer.byteLength(content),
  };
  entry.file = {
    attrs: { fileName, documentId, decryptedSize: Buffer.byteLength(content) },
    path: `files/${documentId}___${fileName}`,
  };
  return entry;
}

const archived = login(8, 'Retired inventory scanner', 'inventory');
archived.state = 'archived';
const examples = [
  richLogin,
  item(2, 'Finance sandbox card', '002', {
    notesPlain: 'Synthetic card for a billing rehearsal. Never charge.',
    sections: [
      section('Card', 'card', [
        field('Cardholder', 'cardholder', { string: 'TRAINING OPERATIONS' }),
        field('Number', 'number', { creditCardNumber: '0000 0000 0000 0000' }),
        field('Expiry', 'expiry', { monthYear: 209912 }),
        field('Security code', 'cvc', { concealed: '000' }),
        field('PIN', 'pin', { concealed: '0007' }),
      ]),
    ],
  }),
  item(3, 'Inventory handheld PIN', '005', {
    sections: [
      section('Access', 'access', [
        field('PIN', 'pin', { concealed: '0009' }),
        field('Asset tag', 'asset-tag', { string: 'TRAINING-HANDHELD-09' }),
      ]),
    ],
  }),
  item(4, 'Route quote API credential', '111', {
    notesPlain: 'Read-only route simulations.',
    sections: [
      section('API', 'api', [
        field('Client ID', 'client-id', { string: 'fixture-routing-client' }),
        field('Credential', 'credential', { concealed: marker(4, 'API-CREDENTIAL') }),
        field('Endpoint', 'endpoint', { url: endpoint('routing') + '/v2/quotes' }),
        field(
          'Private material marker',
          'private-marker',
          { concealed: fakePem },
          { multiline: true },
        ),
      ]),
    ],
  }),
  item(5, 'Night shift escalation notes', '003', {
    notesPlain:
      '## Escalation\n\n1. Check the failed batch.\n2. Notify the next shift at ops@example.invalid.\n\n確認してから再試行 🚦\n',
  }),
  attach(item(6, 'Shift handoff document only', '007', {}), document),
  attach(login(7, 'Billing approval login and attachment', 'billing'), pdfLike),
  archived,
  ...times(34, (n) => {
    const i = n + 8;
    const service = serviceAt(n);
    if (n % 5 === 0) {
      return item(
        i,
        `Recovery runbook — ${service} /${i}`,
        '003',
        {
          notesPlain: `# ${service} rehearsal\n\nRun ticket FIXTURE-${i}.\nCheck the log and hand over to the local shift.\n`,
          sections: [
            section('Runbook', 'runbook', [
              field('Escalation mailbox', 'mailbox', { email: `escalation@${host(service)}` }),
              field('Recovery marker', 'marker', { concealed: marker(i, 'RUNBOOK') }),
            ]),
          ],
        },
        { tags: ['runbook', 'fixture', service] },
      );
    }
    return login(i, `${service} console / region ${(n % 4) + 1} / account ${i}`, service);
  }),
];

function exportData(vaults) {
  return {
    accounts: [
      {
        attrs: {
          accountName: 'Northline Logistics Training',
          name: 'Synthetic fixture operator',
          email: 'operator@northline.example.invalid',
          uuid: uuid(6001),
          domain: endpoint('northline'),
          avatar: '',
        },
        vaults: vaults.map(([name, items], i) => ({
          attrs: {
            uuid: uuid(6100 + i),
            desc: `Synthetic ${name} exports`,
            avatar: '',
            name,
            type: i === 0 ? 'E' : 'U',
          },
          items,
        })),
      },
    ],
  };
}

const rich = exportData([
  ['Shared', examples.slice(0, 14)],
  ['Operations — EU', examples.slice(14, 28)],
  ['Finance & Routing', examples.slice(28)],
]);
const bulk = exportData(
  times(7, (vault) => [
    `Service Operations ${vault}`,
    times(150, (offset) => {
      const id = (vault - 1) * 150 + offset;
      const service = serviceAt(id);
      return login(id, `${service} / vault ${vault} / rotation account ${offset}`, service);
    }),
  ]),
);

function archive(data, version, attachments = []) {
  const members = {
    'export.attributes': strToU8(
      json({ version, description: '1Password Unencrypted Export', createdAt: timestamp }),
    ),
    'export.data': strToU8(json(data)),
    'files/': new Uint8Array(),
  };
  for (const { fileName, documentId, content } of attachments) {
    members[`files/${documentId}___${fileName}`] = strToU8(content);
  }
  const bytes = zipSync(members, { mtime: new Date(2026, 0, 2), level: 6 });
  const restored = unzipSync(bytes);
  assert.deepEqual(Object.keys(restored), Object.keys(members));
  for (const [name, content] of Object.entries(members)) assert.deepEqual(restored[name], content);
  assert.equal(JSON.parse(Buffer.from(restored['export.attributes'])).version, version);
  return bytes;
}

const richChecks = [
  { title: richLogin.overview.title, field: 'password', sha256: sha256(exactPassword) },
  { title: richLogin.overview.title, field: 'notes', sha256: sha256(richLogin.details.notesPlain) },
  {
    title: richLogin.overview.title,
    field: 'Recovery: Code',
    sha256: sha256(marker(1, 'RECOVERY-MAIN')),
  },
  {
    title: richLogin.overview.title,
    field: 'Recovery: Code (2)',
    sha256: sha256(marker(1, 'RECOVERY-SPARE')),
  },
  {
    title: richLogin.overview.title,
    field: 'Recovery: Code (3)',
    sha256: sha256(marker(1, 'RECOVERY-BACKUP')),
  },
  {
    title: richLogin.overview.title,
    field: 'Recovery: מפתח 🔐',
    sha256: sha256('復旧手順\nLinha dois\tτελικό'),
  },
  { title: richLogin.overview.title, field: 'Fixture types: Retry count', sha256: sha256('0') },
  { title: richLogin.overview.title, field: 'Fixture types: Enabled', sha256: sha256('false') },
  {
    title: richLogin.overview.title,
    field: 'Fixture types: Nested labels',
    sha256: sha256(
      JSON.stringify({
        fixtureArray: [
          ['warehouse', 'dispatch'],
          [0, false],
        ],
      }),
    ),
  },
  {
    title: richLogin.overview.title,
    field: 'URL: Recovery (2)',
    sha256: sha256(endpoint('backup.dispatch') + '/access#fixture'),
  },
  {
    title: richLogin.overview.title,
    field: 'details/futureMetadata',
    sha256: sha256(JSON.stringify(richLogin.details.futureMetadata)),
  },
  {
    title: richLogin.overview.title,
    field: 'overview/futureBadge',
    sha256: sha256(JSON.stringify(richLogin.overview.futureBadge)),
  },
  {
    title: examples[1].overview.title,
    field: 'creditCardNumber',
    sha256: sha256('0000 0000 0000 0000'),
  },
  {
    title: examples[3].overview.title,
    field: 'API: Private material marker',
    sha256: sha256(fakePem),
  },
];
const richDetails = {
  format: 'onepassword',
  version: 3,
  sourceRecords: 42,
  expectedEntries: 41,
  vaults: 3,
  attachments: 2,
  historyItems: 1,
  archivedItems: 1,
  checks: richChecks,
  omitted: [
    { title: examples[5].overview.title, scope: 'entry', reason: 'file-only item' },
    { title: examples[6].overview.title, scope: 'file contents', reason: 'text import only' },
    {
      title: richLogin.overview.title,
      scope: 'password history',
      reason: 'current credentials only',
    },
  ],
};
assert.equal(
  rich.accounts[0].vaults.flatMap(({ items }) => items).length,
  richDetails.sourceRecords,
);
assert.equal(bulk.accounts[0].vaults.flatMap(({ items }) => items).length, 1050);
await emit('onepassword-rich.1pux', archive(rich, 3, [document, pdfLike]), richDetails);
await emit('onepassword-rich.export-data.json', json(rich), {
  format: 'onepassword-source',
  sourceRecords: 42,
  role: 'editable archive source',
});
await emit('onepassword-bulk.1pux', archive(bulk, 3), {
  format: 'onepassword',
  version: 3,
  sourceRecords: 1050,
  expectedEntries: 1050,
  vaults: 7,
});
await emit('unsupported/onepassword-v4.1pux', archive(exportData([['Shared', [examples[0]]]]), 4), {
  format: 'onepassword',
  version: 4,
  sourceRecords: 1,
  expectedError: 'Unsupported 1Password export version',
});
await emit(
  'unsupported/shift-handoff.zip',
  zipSync({ 'shift-handoff.txt': strToU8(document.content) }, { mtime: new Date(2026, 0, 2) }),
  {
    format: 'unknown zip',
    sourceRecords: 0,
    expectedError: 'Unsupported ZIP archive',
  },
);
const worksheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const officeRelationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationship = 'http://schemas.openxmlformats.org/package/2006/relationships';
const workbook = {
  '[Content_Types].xml':
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>',
  '_rels/.rels': `<Relationships xmlns="${packageRelationship}"><Relationship Id="rId1" Type="${officeRelationship}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml': `<workbook xmlns="${worksheetNamespace}" xmlns:r="${officeRelationship}"><sheets><sheet name="Handoff" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${packageRelationship}"><Relationship Id="rId1" Type="${officeRelationship}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  'xl/worksheets/sheet1.xml': `<worksheet xmlns="${worksheetNamespace}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Synthetic shift handoff</t></is></c></row></sheetData></worksheet>`,
};
await emit(
  'unsupported/shift-handoff.xlsx',
  zipSync(Object.fromEntries(Object.entries(workbook).map(([name, xml]) => [name, strToU8(xml)])), {
    mtime: new Date(2026, 0, 2),
  }),
  { format: 'excel', sourceRecords: 1, expectedError: 'Excel workbooks are unsupported' },
);
await emit('malformed/truncated.1pux', archive(rich, 3, [document, pdfLike]).subarray(0, 70), {
  format: 'onepassword',
  expectedError: 'ZIP directory',
});

const passbolt = times(36, (i) => ({
  id: uuid(7000 + i),
  name: i === 1 ? 'Support, "Après-vente" / 出荷' : `${serviceAt(i)} operator ${i}`,
  username: `operator-${i}@${host(serviceAt(i))}`,
  uri: endpoint(serviceAt(i)) + '/admin',
  password: i === 2 ? '  SYNTHETIC-FIXTURE-CSV-EDGE # literal  ' : marker(i, 'PASSBOLT'),
  description: `Training rotation ${i}, runbook "Night shift".\r\nOwner: São Paulo / 台北.\r\n`,
  folder: `Training/${serviceAt(i)}/Shift ${i % 3}`,
  tags: ['fixture', serviceAt(i)],
}));
const csvColumns = ['Name', 'Username', 'URL', 'Password', 'Description', 'Group', 'Tags'];
const csvQuote = (value) => '"' + String(value).replaceAll('"', '""') + '"';
const csvRows = passbolt.map(({ name, username, uri, password, description, folder, tags }) =>
  [name, username, uri, password, description, folder, tags.join(';')].map(csvQuote).join(','),
);
await emit('passbolt-export.csv', '\uFEFF' + [csvColumns.join(','), ...csvRows, ''].join('\r\n'), {
  format: 'passbolt',
  sourceRecords: passbolt.length,
  expectedEntries: 36,
  scenarios: [
    'UTF-8 BOM',
    'CRLF quoted multiline notes',
    'literal comma and double quote',
    'whitespace-sensitive password',
  ],
});
await emit(
  'passbolt-compatible.json',
  json({
    resources: passbolt.map(({ password, folder, ...resource }, i) => ({
      ...resource,
      folder_parent: { name: folder },
      personal: false,
      rotationWindowDays: 0,
      secret:
        i === 35
          ? {}
          : { password, recovery_hint: marker(i + 1, 'PASSBOLT-RECOVERY'), grace_period: 0 },
    })),
  }),
  {
    format: 'passbolt',
    provenance: 'Importer-compatible resources wrapper',
    sourceRecords: 36,
    expectedEntries: 36,
    scenarios: [
      '36 resources, one without a secret',
      'structured secret with numeric zero',
      'folder parent object',
    ],
  },
);

const kube = times(36, (i) => {
  const service = serviceAt(i);
  const metadata = {
    name: `${service}-${i}`,
    namespace: ['training-dev', 'training-stage', 'recovery-lab'][i % 3],
    uid: uuid(8000 + i),
    labels: { app: service, environment: 'fixture' },
  };
  if (i % 6 === 0) {
    return {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata,
      data: {
        'app.toml': '[feature]\nenabled = false\nretries = 0\n',
        endpoint: endpoint(service),
        locale: '日本語',
      },
      binaryData: { 'header.bytes': b64([0, 255, 16, i]) },
    };
  }
  if (i % 6 === 1) {
    return {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata,
      type: 'kubernetes.io/dockerconfigjson',
      data: {
        '.dockerconfigjson': b64(
          JSON.stringify({
            auths: {
              [host('registry-primary')]: { auth: b64(`fixture-robot:${marker(i, 'REGISTRY')}`) },
              [host('registry-mirror')]: {
                username: 'fixture-readonly',
                password: marker(i, 'MIRROR'),
              },
            },
          }),
        ),
      },
    };
  }
  if (i % 6 === 2) {
    return {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata,
      type: 'kubernetes.io/tls',
      stringData: { 'tls.crt': 'SYNTHETIC CERTIFICATE MARKER ONLY\n', 'tls.key': fakePem },
    };
  }
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata,
    type: 'Opaque',
    data: {
      username: b64('fixture-reader'),
      password: b64(marker(i, 'K8S-DATA')),
      'zero.txt': b64('0'),
    },
    stringData: {
      password: marker(i, 'K8S-STRINGDATA-WINS'),
      endpoint: endpoint(service),
      disabled: 'false',
      empty: '',
    },
  };
});
const skipped = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'training-dev' } };
const kubernetesYaml = yamlDocs([...kube, skipped]);
assert.equal(parseAllDocuments(kubernetesYaml).length, 37);
for (const [name, content] of [
  ['kubernetes-multidoc.yaml', kubernetesYaml],
  ['kubernetes-list.json', json({ apiVersion: 'v1', kind: 'List', items: [...kube, skipped] })],
]) {
  await emit(name, content, {
    format: 'kubernetes',
    sourceRecords: 37,
    expectedEntries: 36,
    scenarios: [
      'Secret and ConfigMap',
      'docker config with two registries',
      'stringData overrides data',
      'binary base64',
      'one skipped Namespace',
    ],
  });
}

function servicePayload(i, provider) {
  const service = serviceAt(i);
  return {
    username: `${service}-fixture-reader`,
    password: marker(i, provider),
    url: endpoint(service),
    region: ['fixture-west', 'fixture-east'][i % 2],
    enabled: false,
    retries: 0,
    alias: '',
    'credential hint 🔐': `Rotación ${i}\n  保存位置\n`,
    policy: {
      roles: ['fixture-viewer', 'fixture-rotation'],
      limits: { maxAttempts: 0, enabled: false },
    },
    private_material_marker: fakePem,
  };
}

const leases = times(30, (i) => ({
  request_id: uuid(9000 + i),
  lease_id: '',
  renewable: false,
  lease_duration: 0,
  path: `fixture/${serviceAt(i)}/rotation-${i}`,
  data: servicePayload(i, 'VAULT-V1'),
  wrap_info: null,
  warnings: null,
  auth: null,
}));
const vaultYaml = yamlDocs(leases);
assert.equal(parseAllDocuments(vaultYaml).length, 30);
await emit('vault-kv-v1.yaml', vaultYaml, {
  format: 'vault',
  version: 1,
  sourceRecords: 30,
  expectedEntries: 30,
});
await emit(
  'vault-kv-v2.json',
  json(
    leases.map(({ data, ...lease }, i) => ({
      ...lease,
      data: {
        data: { ...data, password: marker(i + 1, 'VAULT-V2') },
        metadata: {
          created_time: '2025-11-01T00:00:00Z',
          deletion_time: '',
          destroyed: false,
          version: (i % 5) + 1,
          custom_metadata: { owner: 'fixture-operations' },
        },
      },
    })),
  ),
  {
    format: 'vault',
    version: 2,
    sourceRecords: 30,
    expectedEntries: 30,
    scenarios: [
      'versioned API envelopes',
      'scalar falsy values and nested policy',
      'Unicode key and multiline marker',
    ],
  },
);

await emit(
  'aws-secretsmanager.json',
  json({
    SecretValues: times(27, (i) => ({
      ARN: `arn:aws:secretsmanager:us-east-1:000000000000:secret:fixture/${serviceAt(i)}-${i}-SYN000`,
      Name: `fixture/${serviceAt(i)}-${i}`,
      VersionId: uuid(10000 + i),
      VersionStages: [i % 4 === 0 ? 'AWSPREVIOUS' : 'AWSCURRENT'],
      CreatedDate: timestamp,
      ...(i % 3 === 0
        ? { SecretBinary: i % 2 ? b64([0, 255, 16, i]) : b64(marker(i, 'AWS-BINARY')) }
        : {
            SecretString:
              i % 3 === 1 ? JSON.stringify(servicePayload(i, 'AWS')) : marker(i, 'AWS-PLAIN'),
          }),
    })),
    Errors: [],
  }),
  {
    format: 'cloud',
    provider: 'aws',
    sourceRecords: 27,
    expectedEntries: 27,
    scenarios: [
      'BatchGetSecretValue wrapper',
      'SecretString JSON and plain text',
      'SecretBinary text and opaque bytes',
      'version stages',
    ],
  },
);
await emit(
  'azure-keyvault.json',
  json(
    times(27, (i) => ({
      id: `${endpoint('training-vault.vault.azure.net')}/secrets/${serviceAt(i)}-${i}/${String(i).padStart(32, '0')}`,
      value: i % 3 === 0 ? marker(i, 'AZURE-PLAIN') : JSON.stringify(servicePayload(i, 'AZURE')),
      attributes: {
        enabled: i % 3 !== 0,
        created: timestamp,
        updated: timestamp + i,
        recoveryLevel: 'Recoverable',
      },
      contentType: i % 3 === 0 ? 'text/plain' : 'application/json',
      tags: { owner: serviceAt(i), environment: 'fixture' },
    })),
  ),
  {
    format: 'cloud',
    provider: 'azure',
    sourceRecords: 27,
    expectedEntries: 27,
    scenarios: [
      'array of synthetic Get Secret responses',
      'plain and structured value',
      'disabled versions',
    ],
  },
);
await emit(
  'gcp-secretmanager.json',
  json(
    times(27, (i) => ({
      name: `projects/synthetic-fixture/secrets/${serviceAt(i)}-${i}/versions/${(i % 3) + 1}`,
      payload: {
        data:
          i % 3 === 0 ? b64(marker(i, 'GCP-PLAIN')) : b64(JSON.stringify(servicePayload(i, 'GCP'))),
      },
    })),
  ),
  {
    format: 'cloud',
    provider: 'gcp',
    sourceRecords: 27,
    expectedEntries: 27,
    scenarios: ['array of synthetic access responses', 'base64 of plain and nested JSON values'],
  },
);

const envLines = [
  'export REGION="fixture-west"',
  'ROUTING_URL=https://routing.example.invalid/v2 # standby endpoint',
  'RETRY_COUNT=0',
  'FEATURE_ACTIVE=false',
  'UNSET_ALIAS=',
  'WHITESPACE_TEST="  SYNTHETIC-FIXTURE-ENV # literal  "',
  'HASH_TEST=fixture#kept',
  'UNICODE_HELP="Rotación — 運用 🚚"',
  'PRIVATE_MARKER="' + fakePem + '"',
  'ESCAPES="line one\\nline two\\tfixture"',
  'DUPLICATE_SLOT=synthetic-first',
  'DUPLICATE_SLOT=synthetic-second',
  ...times(30, (i) => `SERVICE_${String(i).padStart(2, '0')}_TOKEN=${marker(i, 'ENV')}`),
];
await emit(
  'services.env',
  ['# Northline Logistics synthetic services', ...envLines, ''].join('\n'),
  {
    format: 'dotenv',
    sourceRecords: 42,
    expectedEntries: 41,
    scenarios: [
      'quoted multiline',
      'escapes',
      'comments',
      'explicit empty value',
      'duplicate keys',
      'preserved spaces and hash inside quoted value',
    ],
  },
);

await emit(
  'manifest.json',
  json({
    synthetic: true,
    provenance:
      'Generated locally from authored synthetic records and documented format structures. No real exports or credentials.',
    files,
  }),
);
console.log(
  `${check ? 'Verified' : 'Generated'} ${Object.keys(files).length} fixtures and manifest.json`,
);
