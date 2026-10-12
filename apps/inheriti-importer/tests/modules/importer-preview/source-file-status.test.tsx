import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileRow } from '@modules/importer-preview/SourceImportStatus/components/FileRow';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';

afterEach(cleanup);

describe('source file status', () => {
  it('supports unlocking a KeePass source with only a key file', async () => {
    const source: ImportFile = {
      id: 'source-1',
      name: 'vault.kdbx',
      format: 'KeePass',
      status: 'unlock-required',
    };
    const keyBytes = new ArrayBuffer(4);
    const keyFile = new File(['key'], 'vault.key');
    Object.defineProperty(keyFile, 'arrayBuffer', { value: vi.fn().mockResolvedValue(keyBytes) });
    const onUnlock = vi.fn();
    render(<FileRow file={source} initiallyShowUnlock onUnlock={onUnlock} />);

    expect(screen.getByText('Master password')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('KeePass key file'), { target: { files: [keyFile] } });
    const submit = screen.getAllByRole('button', { name: 'Unlock' })[1];
    await waitFor(() => expect(submit.getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(submit);

    expect(onUnlock).toHaveBeenCalledWith(source, '', keyBytes);
  });

  it('renders the actual parser failure instead of format-specific fixture text', () => {
    render(
      <FileRow
        file={{
          name: 'vault.json',
          format: 'JSON',
          status: 'failed',
          detail: 'Unsupported Vault export shape.',
        }}
      />,
    );

    expect(screen.getAllByText('Unsupported Vault export shape.')).toHaveLength(2);
    expect(screen.queryByText(/Delimiter could not be detected/)).toBeNull();
  });

  it('offers source removal when a callback is provided', () => {
    const source: ImportFile = {
      id: 'source-1',
      name: 'bad.json',
      format: 'JSON',
      status: 'failed',
    };
    const onRemove = vi.fn();
    render(<FileRow file={source} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith(source);
  });

  it('shows source-specific recovery for a known list-only cloud export', () => {
    render(
      <FileRow
        file={{
          name: 'cloud.json',
          format: 'Cloud',
          status: 'failed',
          detail: 'No cloud secrets were found.',
        }}
      />,
    );

    expect(
      screen.getByText(/value-bearing get-secret-value or secret show JSON response/),
    ).toBeTruthy();
  });
});
