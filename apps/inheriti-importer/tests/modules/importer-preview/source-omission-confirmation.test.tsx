import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';

afterEach(cleanup);

const metadata = {
  code: 'onepassword-container-metadata',
  kind: 'skipped',
  count: 1,
  message: 'Source metadata was omitted.',
} as const;
const transformation = {
  code: 'duplicate-source-entry-id',
  kind: 'transformed',
  count: 1,
  message: 'Repeated identifiers were kept as separate entries.',
} as const;
const first = {
  id: 'alpha',
  name: 'alpha.1pux',
  format: '1Password',
  status: 'warning',
  diagnostics: [
    { code: 'attachment', kind: 'unsupported', message: 'Attachments are unsupported.', count: 2 },
    metadata,
  ],
} satisfies ImportFile;
const second = {
  ...first,
  id: 'bravo',
  name: 'bravo.1pux',
  diagnostics: [
    { code: 'field', kind: 'skipped', message: 'A credential field was skipped.', count: 1 },
    transformation,
  ],
} satisfies ImportFile;
const clean = { ...first, id: 'clean', name: 'clean.1pux', diagnostics: [] };
const dialogTitle = 'Some source content won’t be imported';
const dialog = () => screen.getByRole('dialog', { name: dialogTitle });
const queryDialog = () => screen.queryByRole('dialog', { name: dialogTitle });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
const confirm = () =>
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Continue import' }));
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }));
const screenAtSources = () => screen.getByText('Confirm imported sources');
const screenAtAssets = () => screen.getByText('Review detected assets');

function flow(files: ImportFile[]) {
  return (
    <ImporterFlow
      files={files}
      assets={[]}
      unassigned={[]}
      plans={[]}
      checklist={[]}
      callbacks={{}}
    />
  );
}

it('continues directly with only transformed, metadata, and unclassified warnings', () => {
  render(
    flow([
      {
        ...first,
        diagnostics: [metadata, transformation],
        warningMessages: ['An unspecified warning.'],
      },
    ]),
  );
  submit();
  expect(queryDialog()).toBeNull();
  expect(screenAtAssets()).toBeTruthy();
});

it('shows one grouped confirmation for the footer and stepper and remembers the decision', () => {
  render(flow([first, second]));
  submit();
  expect(screenAtSources()).toBeTruthy();
  const report = within(dialog());
  expect(report.getAllByText(/\.1pux$/)).toHaveLength(2);
  expect(report.getByText('alpha.1pux')).toBeTruthy();
  expect(report.getByText('bravo.1pux')).toBeTruthy();
  expect(report.getByText('Unsupported · 2')).toBeTruthy();
  expect(report.getByText('Skipped · 1')).toBeTruthy();
  expect(report.queryByText(metadata.message)).toBeNull();
  expect(report.queryByText(transformation.message)).toBeNull();
  fireEvent.click(report.getByRole('button', { name: 'Cancel', exact: true }));
  expect(screenAtSources()).toBeTruthy();
  expect(queryDialog()).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Review assets/ }));
  expect(screenAtSources()).toBeTruthy();
  confirm();
  expect(screenAtAssets()).toBeTruthy();
  back();
  submit();
  expect(queryDialog()).toBeNull();
  expect(screenAtAssets()).toBeTruthy();
});

it('invalidates the prior decision when sources are added, removed, replaced or omissions change', () => {
  const { rerender } = render(flow([first]));
  submit();
  confirm();
  back();
  rerender(flow([first, clean]));
  submit();
  confirm();
  back();
  rerender(flow([first]));
  submit();
  confirm();
  back();
  const replacement = { ...first, id: 'replacement' };
  rerender(flow([replacement]));
  submit();
  confirm();
  back();
  rerender(flow([{ ...replacement, diagnostics: [{ ...first.diagnostics[0], count: 3 }] }]));
  submit();
  expect(within(dialog()).getByText('Unsupported · 3')).toBeTruthy();
});

it('discards an open confirmation when the source selection changes', () => {
  const { rerender } = render(flow([first]));
  submit();
  expect(dialog()).toBeTruthy();

  rerender(flow([second]));
  expect(queryDialog()).toBeNull();
  expect(screenAtSources()).toBeTruthy();
  submit();
  expect(within(dialog()).getByText('bravo.1pux')).toBeTruthy();
  expect(within(dialog()).queryByText('alpha.1pux')).toBeNull();
  confirm();
  expect(screenAtAssets()).toBeTruthy();
});

it.each(['failed', 'unlock-required', 'retrying', 'unlocking'] as const)(
  'blocks the footer and stepper while a sibling source is %s',
  (status) => {
    render(flow([first, { ...clean, status }]));
    submit();
    fireEvent.click(screen.getByRole('button', { name: /Review assets/ }));
    expect(queryDialog()).toBeNull();
    expect(screenAtSources()).toBeTruthy();
  },
);
