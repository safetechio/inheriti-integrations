// @vitest-environment happy-dom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceFilter } from '@modules/importer-preview/AssetReviewQueue/components/ImportCoverage/components/SourceFilter';

afterEach(cleanup);

const label = 'Filter source field details by source';
const sources = new Map([
  ['source-1', 'Vault.csv (1)'],
  ['source-2', 'Vault.csv (2)'],
  ['source-3', 'KeePass.kdbx'],
  ['source-4', 'Passbolt.csv'],
]);

function ControlledFilter({ sources }: { sources: ReadonlyMap<string, string> }) {
  const [value, setValue] = useState('');
  return <SourceFilter sources={sources} value={value} onChange={setValue} />;
}

describe('source filter', () => {
  it('selects a source by ID and resets to all sources with chips', () => {
    render(<ControlledFilter sources={sources} />);
    const group = within(screen.getByRole('group', { name: label }));
    const all = group.getByRole('button', { name: 'All sources' });
    const source = group.getByRole('button', { name: 'Vault.csv (2)' });
    expect(group.getAllByRole('button')[0]).toBe(all);
    expect(all.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(source);
    expect(source.getAttribute('aria-pressed')).toBe('true');
    expect(group.getByRole('button', { name: 'Vault.csv (1)' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    fireEvent.click(all);
    expect(all.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps many sources in one scrollable row without a tall search field', () => {
    const many = new Map([...sources, ['source-5', 'Secrets.json']]);
    render(<ControlledFilter sources={many} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    const group = within(screen.getByRole('group', { name: label }));
    fireEvent.click(group.getByRole('button', { name: 'Secrets.json' }));
    expect(group.getByRole('button', { name: 'Secrets.json' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(group.getByRole('button', { name: 'All sources' }));
    expect(group.getByRole('button', { name: 'All sources' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
