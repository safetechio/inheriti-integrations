// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ImportDiagnosticCard } from '@modules/importer-preview/components/ImportDiagnosticCard';
import type { ImportDiagnostic } from '@modules/import/domain/import-diagnostic';

afterEach(cleanup);

it.each([
  {
    code: 'onepassword-login-settings',
    kind: 'skipped',
    reason: 'Login field metadata can describe a field or control browser autofill.',
    outcome:
      'The importer may use identifiers and types to recognize fields. Browser autofill behavior stays in 1Password.',
  },
  {
    code: 'onepassword-field-text',
    kind: 'transformed',
    reason: 'The source used a typed value and the importer reads these fields as text.',
    outcome: 'The importer converted the value to text. Empty results do not create fields.',
  },
  {
    code: 'onepassword-attachments',
    kind: 'unsupported',
    reason:
      'The 1Password import reads credential fields and has no destination for attached files.',
    outcome: 'The archive attachments were left out of the import.',
  },
  {
    code: 'onepassword-password-history',
    kind: 'transformed',
    reason: 'These values are previous versions of a password.',
    outcome: 'The importer kept the readable history in a protected field for manual mapping.',
  },
  {
    code: 'onepassword-url-metadata',
    kind: 'skipped',
    reason: 'The reported settings control how 1Password matches websites.',
    outcome:
      'The importer omitted matching settings, kept primary labels for manual mapping, and used alternative labels in their URL field names.',
  },
  {
    code: 'onepassword-unreadable-field',
    kind: 'unsupported',
    reason: 'The importer could not read this field or encountered unsupported content.',
    outcome: 'The importer left out the unreadable or unsupported content.',
  },
  {
    code: 'onepassword-partial-recovery',
    kind: 'transformed',
    reason: 'The source combined readable values with unsupported content.',
    outcome: 'The importer kept the readable values for review and omitted the unsupported parts.',
  },
  {
    code: 'k8s-docker-unreadable-payload',
    kind: 'unsupported',
    reason: 'The Docker configuration could not be read as individual credentials.',
    outcome: 'The importer kept the original value in a protected field for manual mapping.',
  },
  {
    code: 'keepass-unreadable-protected-field',
    kind: 'unsupported',
    reason: 'The importer could not read the protected field from KeePass.',
    outcome: 'The importer omitted that field and kept other readable fields.',
  },
  {
    code: 'cloud-unsupported-record',
    kind: 'unsupported',
    reason: 'The cloud export record contained no supported secret payload.',
    outcome: 'The importer skipped the record.',
  },
  {
    code: 'dotenv-malformed-line',
    kind: 'skipped',
    reason: 'The line did not form a valid environment variable assignment.',
    outcome: 'The importer skipped the malformed line.',
  },
  {
    code: 'passbolt-value-text',
    kind: 'transformed',
    reason: 'The source included non-text values and the importer uses text fields.',
    outcome: 'The importer represented the affected values as text or JSON for review.',
  },
  {
    code: 'constructor',
    kind: 'transformed',
    reason: 'The warning does not identify why a conversion was needed.',
    outcome: 'The importer changed the representation of the reported content.',
  },
] satisfies { code: string; kind: ImportDiagnostic['kind']; reason: string; outcome: string }[])(
  'explains $code only when warning details are expanded',
  ({ code, kind, reason, outcome }) => {
    const occurrence = {
      code,
      kind,
      message: 'The importer reported a source field.',
      count: 1,
      sourcePath: ['items', '0'],
      entryName: 'Account',
    };
    render(<ImportDiagnosticCard {...occurrence} occurrences={[occurrence]} />);
    const explanation = `${reason} ${outcome}`;
    expect(screen.getByText(occurrence.message)).toBeTruthy();
    expect(screen.queryByText(explanation)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View details (1)' }));
    expect(screen.getByText(explanation)).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toContain('items › 0');

    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(screen.queryByText(explanation)).toBeNull();
  },
);

it('distinguishes omitted source configuration from unsupported content', () => {
  render(
    <ImportDiagnosticCard
      code="onepassword-login-settings"
      kind="skipped"
      count={3}
      message="Browser settings omitted."
    />,
  );
  expect(screen.getByText('Source metadata · 3')).toBeTruthy();
});
