import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SourceImportStatus, type ImportFile } from '@modules/importer-preview/SourceImportStatus';
import { FileRow } from '@modules/importer-preview/SourceImportStatus/components/FileRow';
import { SourceWarningsModal } from '@modules/importer-preview/SourceImportStatus/components/SourceWarningsModal';

afterEach(cleanup);
const files: ImportFile[] = [
  { id: 'ready', name: 'ready.env', format: 'dotenv', status: 'imported', entries: 1 },
  {
    id: 'warning',
    name: 'warning.1pux',
    format: '1Password',
    status: 'warning',
    warnings: 1,
    warningMessages: ['An unsupported field was skipped.'],
  },
  { id: 'locked', name: 'locked.kdbx', format: 'KeePass', status: 'unlock-required' },
];

describe('source review improvements', () => {
  it('sorts locked sources first, then unacknowledged warnings without mutating input', () => {
    const { container } = render(<SourceImportStatus files={files} />);
    const cards = [...container.querySelectorAll('.source-file-card')];
    expect(cards[0].textContent).toContain('locked.kdbx');
    expect(cards[1].textContent).toContain('warning.1pux');
    expect(files[0].id).toBe('ready');
  });
  it('removes an acknowledged source only from Warnings, keeping it in All', () => {
    const { rerender } = render(<SourceImportStatus files={files} />);
    fireEvent.click(screen.getByRole('button', { name: 'Warnings 1' }));
    expect(screen.queryByText('ready.env')).toBeNull();
    rerender(
      <SourceImportStatus files={files.map((file) => ({ ...file, warningsAcknowledged: true }))} />,
    );
    expect(screen.getByText('No sources match this filter.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    expect(screen.getByText('warning.1pux')).toBeTruthy();
  });
  it('focuses unlock input and toggles visibility without losing credentials', () => {
    render(<FileRow file={files[2]} initiallyShowUnlock onUnlock={vi.fn()} />);
    const input = screen.getByLabelText('Master password') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'synthetic-unlock-password' } });
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
    expect(input.value).toBe('synthetic-unlock-password');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input.type).toBe('password');
  });
  it('acknowledges parser warnings only through Understood', () => {
    const onUnderstood = vi.fn();
    render(<SourceWarningsModal file={files[1]} onDismiss={vi.fn()} onUnderstood={onUnderstood} />);
    expect(onUnderstood).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Understood' }));
    expect(onUnderstood).toHaveBeenCalledWith(files[1]);
  });
});
