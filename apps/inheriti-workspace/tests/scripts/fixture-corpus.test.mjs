import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const files = new Map(manifest.files.map((entry) => [entry.file, entry]));
const inventory = [
  'sample-image.png',
  'sample-document.pdf',
  'sample-spreadsheet.xlsx',
  'sample-notes.txt',
  'sample-data.json',
  'sample-table.csv',
  'sample-letter.docx',
  'sample-letter.odt',
  'sample-archive.zip',
  'sample-video.mp4',
  'sample-video.webm',
  'truncated-image.png',
];

test('portable fixtures have a complete, unchanged inventory', () => {
  assert.equal(manifest.schema, 1);
  assert.equal(files.size, inventory.length);
  assert.deepEqual([...files.keys()], inventory);
  assert.deepEqual(readdirSync(root).sort(), ['manifest.json', ...inventory].sort());
  for (const entry of files.values()) {
    const bytes = readFileSync(join(root, entry.file));
    assert.equal(bytes.length, entry.bytes, `${entry.file} length`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${entry.file} SHA-256`);
    assert.match(entry.contentType, /^[a-z]+\/[a-z0-9.+-]+$/);
    assert.deepEqual(Object.keys(entry.expected).sort(), [
      'guestAdmission', 'guestLaunchAck', 'portableSessionAdmission',
    ]);
    assert.equal(entry.expected.portableSessionAdmission, true);
    assert.equal(typeof entry.expected.guestAdmission, 'boolean');
    assert.equal(typeof entry.expected.guestLaunchAck, 'boolean');
    if (!entry.expected.guestAdmission) assert.equal(entry.expected.guestLaunchAck, false);
  }
});

test('the malformed image distinguishes admission from launch acknowledgement', () => {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const image = readFileSync(join(root, 'sample-image.png'));
  const truncated = readFileSync(join(root, 'truncated-image.png'));
  assert.ok(image.subarray(0, 8).equals(signature));
  assert.equal(image.toString('ascii', 12, 16), 'IHDR');
  assert.equal(image.subarray(-8, -4).toString('ascii'), 'IEND');
  assert.ok(truncated.equals(signature));
  assert.equal(files.get('sample-image.png').expected.guestLaunchAck, true);
  assert.deepEqual(files.get('truncated-image.png').expected, {
    portableSessionAdmission: true,
    guestAdmission: true,
    guestLaunchAck: false,
  });
});

test('text fixtures are readable UTF-8 with representative JSON and CSV content', () => {
  for (const name of ['sample-notes.txt', 'sample-data.json', 'sample-table.csv']) {
    const bytes = readFileSync(join(root, name));
    assert.equal(Buffer.from(bytes.toString('utf8'), 'utf8').compare(bytes), 0, name);
    assert.ok(bytes.includes(0x0a), name);
    assert.equal(files.get(name).expected.guestAdmission, true);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'sample-data.json'), 'utf8')).items, [1, 2]);
  assert.match(readFileSync(join(root, 'sample-table.csv'), 'utf8'), /^member,role\n[^\n]+,[^\n]+\n/);
});

test('PDF and ZIP documents retain the signatures and members needed by guest viewers', () => {
  const pdf = readFileSync(join(root, 'sample-document.pdf'));
  assert.ok(pdf.subarray(0, 8).toString('ascii').startsWith('%PDF-1.4'));
  const match = /startxref\n(\d+)\n%%EOF\n$/.exec(pdf.toString('latin1'));
  assert.ok(match);
  assert.equal(pdf.subarray(Number(match[1]), Number(match[1]) + 4).toString('ascii'), 'xref');

  for (const [name, members] of [
    ['sample-spreadsheet.xlsx', ['xl/workbook.xml', 'xl/worksheets/sheet1.xml']],
    ['sample-letter.docx', ['[Content_Types].xml', 'word/document.xml', '_rels/.rels']],
    ['sample-letter.odt', ['mimetype', 'content.xml', 'META-INF/manifest.xml']],
    ['sample-archive.zip', ['README.txt']],
  ]) {
    const archive = readFileSync(join(root, name));
    assert.ok(archive.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')), name);
    assert.ok(archive.includes(Buffer.from('504b0506', 'hex')), `${name} end of central directory`);
    for (const member of members) assert.ok(archive.includes(Buffer.from(member)), `${name}: ${member}`);
    assert.equal(files.get(name).expected.guestAdmission, true);
  }
});

test('video fixtures carry local container signatures and stay below guest ingress limit', () => {
  const mp4 = readFileSync(join(root, 'sample-video.mp4'));
  const webm = readFileSync(join(root, 'sample-video.webm'));
  assert.equal(mp4.toString('ascii', 4, 8), 'ftyp');
  assert.deepEqual(webm.subarray(0, 4), Buffer.from('1a45dfa3', 'hex'));
  for (const name of ['sample-video.mp4', 'sample-video.webm']) {
    assert.ok(files.get(name).bytes < 16 * 1024 * 1024);
    assert.equal(files.get(name).expected.guestAdmission, false);
  }
});
