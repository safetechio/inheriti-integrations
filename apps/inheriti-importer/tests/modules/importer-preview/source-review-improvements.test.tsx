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
  it('sorts locked sources first, then warnings without mutating input', () => {
    const { container } = render(<SourceImportStatus files={files} />);
    const cards = [...container.querySelectorAll('.source-file-card')];
    expect(cards[0].textContent).toContain('locked.kdbx');
    expect(cards[1].textContent).toContain('warning.1pux');
    expect(files[0].id).toBe('ready');
  });
  it('keeps sources in the Warnings filter after the optional details close', () => {
    const onViewWarnings = vi.fn();
    render(<SourceImportStatus files={files} onViewWarnings={onViewWarnings} />);
    fireEvent.click(screen.getByRole('button', { name: 'Warnings 1' }));
    expect(screen.queryByText('ready.env')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View warnings' }));
    expect(onViewWarnings).toHaveBeenCalledWith(files[1]);
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
  it('closes informational warnings with Done', () => {
    const onDismiss = vi.fn();
    render(<SourceWarningsModal file={files[1]} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
