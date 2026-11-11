import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileRow } from '@modules/importer-preview/SourceImportStatus/components/FileRow';
import { SourceImportStatus } from '@modules/importer-preview/SourceImportStatus';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    const passwordInput = screen.getByLabelText('Master password') as HTMLInputElement;
    expect(passwordInput.closest('.source-unlock-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show password' })).toBeTruthy();
    expect((screen.getByLabelText('KeePass key file') as HTMLInputElement).tabIndex).toBe(-1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Show password' }), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
    expect(screen.queryByText('Unlock required')).toBeNull();
    fireEvent.change(screen.getByLabelText('KeePass key file'), { target: { files: [keyFile] } });
    await screen.findByText('vault.key');
    const submit = screen.getAllByRole('button', { name: 'Unlock' })[1];
    expect(submit.hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith(source, '', keyBytes));
  });

  it('cancels unlock, clears factors, and restores focus to the trigger', async () => {
    const source: ImportFile = { name: 'cancel.kdbx', format: 'KeePass', status: 'unlock-required' };
    const bytes = new Uint8Array([1, 2]).buffer;
    const selected = new File(['key'], 'cancel.key');
    Object.defineProperty(selected, 'arrayBuffer', { value: vi.fn().mockResolvedValue(bytes) });
    render(<FileRow file={source} onUnlock={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Unlock' });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'secret' } });
    fireEvent.change(screen.getByLabelText('KeePass key file'), { target: { files: [selected] } });
    await screen.findByText('cancel.key');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(2));
    expect(screen.queryByLabelText('Master password')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect((screen.getByLabelText('Master password') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('cancel.key')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Unlock' })[1].hasAttribute('disabled')).toBe(true);
  });

  it('wipes a key file read that finishes after cancellation', async () => {
    const bytes = new Uint8Array([7, 8]).buffer;
    let finishRead!: (value: ArrayBuffer) => void;
    const selected = new File(['key'], 'late.key');
    Object.defineProperty(selected, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>((resolve) => { finishRead = resolve; }),
    });
    render(<FileRow file={{ name: 'late.kdbx', format: 'KeePass', status: 'unlock-required' }} initiallyShowUnlock onUnlock={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('KeePass key file'), { target: { files: [selected] } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    finishRead(bytes);
    await waitFor(() => expect(new Uint8Array(bytes)).toEqual(new Uint8Array(2)));
    expect(screen.queryByText('late.key')).toBeNull();
  });

  it('renders a floating popover and dismisses with Escape or outside pointer', () => {
    const source: ImportFile = { name: 'floating.kdbx', format: 'KeePass', status: 'unlock-required' };
    render(<FileRow file={source} onUnlock={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Unlock' });
    fireEvent.click(trigger);
    const panel = screen.getByRole('dialog', { name: 'Unlock KeePass database' });
    expect(panel.parentElement).toBe(document.body);
    expect(panel.closest('.source-file-card')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Master password'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses an idle floating popover when its trigger scrolls offscreen', () => {
    render(<FileRow file={{ name: 'scroll.kdbx', format: 'KeePass', status: 'unlock-required' }} onUnlock={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Unlock' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    vi.spyOn(trigger.parentElement!, 'getBoundingClientRect').mockReturnValue({
      top: -50, bottom: -10, left: 100, right: 180, width: 80, height: 40,
    } as DOMRect);
    fireEvent.scroll(window);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses when an ancestor scrollport clips the trigger', () => {
    let notify!: IntersectionObserverCallback;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe() {}
      disconnect() {}
    });
    render(<FileRow file={{ name: 'clipped.kdbx', format: 'KeePass', status: 'unlock-required' }} onUnlock={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the floating popover and factors while unlocking', () => {
    const source: ImportFile = { name: 'busy.kdbx', format: 'KeePass', status: 'unlock-required' };
    const props = { initiallyShowUnlock: true, onUnlock: vi.fn() };
    const { rerender } = render(<FileRow file={source} {...props} />);
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'test' } });
    rerender(<FileRow file={{ ...source, status: 'unlocking' }} {...props} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText('Master password') as HTMLInputElement).value).toBe('test');
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows a KeePass error in the password field only after an unlock attempt', () => {
    const source: ImportFile = {
      name: 'error.kdbx', format: 'KeePass', status: 'unlock-required',
      detail: 'Could not open KeePass database. Check the password or key file.',
    };
    const props = { initiallyShowUnlock: true, onUnlock: vi.fn() };
    const { rerender } = render(<FileRow file={source} {...props} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(source.detail!)).toBeNull();
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Unlock' })[1]);
    rerender(<FileRow file={{ ...source, status: 'unlocking', detail: undefined }} {...props} />);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<FileRow file={source} {...props} />);
    expect(screen.getByRole('alert').textContent).toBe(source.detail);
    expect((screen.getByLabelText('Master password') as HTMLInputElement).value).toBe('wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the full source filename in the native hover title', () => {
    const name = 'very-long-synthetic-production-database-export.kdbx';
    render(<FileRow file={{ name, format: 'KeePass', status: 'unlock-required' }} />);
    expect(screen.getByText(name).closest('[title]')?.getAttribute('title')).toBe(name);
  });

  it('allows a whitespace-only KeePass password without changing its bytes', () => {
    const source: ImportFile = { name: 'space.kdbx', format: 'KeePass', status: 'unlock-required' };
    const onUnlock = vi.fn();
    render(<FileRow file={source} initiallyShowUnlock onUnlock={onUnlock} />);
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: ' ' } });
    const submit = screen.getAllByRole('button', { name: 'Unlock' })[1];
    expect(submit.hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit);
    expect(onUnlock).toHaveBeenCalledWith(source, ' ', undefined);
  });

  it('keeps unlock factors through unlocking and clears them after import', async () => {
    const source: ImportFile = { name: 'retry.kdbx', format: 'KeePass', status: 'unlock-required' };
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const selected = new File(['key'], 'retry.key');
    Object.defineProperty(selected, 'arrayBuffer', { value: vi.fn().mockResolvedValue(bytes) });
    const props = { initiallyShowUnlock: true, onUnlock: vi.fn() };
    const { rerender } = render(<FileRow file={source} {...props} />);
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText('KeePass key file'), { target: { files: [selected] } });
    await screen.findByText('retry.key');

    rerender(<FileRow file={{ ...source, status: 'unlocking' }} {...props} />);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
    rerender(<FileRow file={source} {...props} />);
    expect((screen.getByLabelText('Master password') as HTMLInputElement).value).toBe('wrong');
    expect(screen.getByText('retry.key')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'correct' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Unlock' })[1]);
    expect(props.onUnlock).toHaveBeenCalledWith(source, 'correct', bytes);

    rerender(<FileRow file={{ ...source, status: 'imported' }} {...props} />);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(4));
  });

  it('clears replaced and unmounted key file bytes', async () => {
    const source: ImportFile = {
      name: 'replace.kdbx',
      format: 'KeePass',
      status: 'unlock-required',
    };
    const firstBytes = new Uint8Array([1, 2]).buffer;
    const secondBytes = new Uint8Array([3, 4]).buffer;
    const first = new File(['first'], 'first.key');
    const second = new File(['second'], 'second.key');
    Object.defineProperty(first, 'arrayBuffer', { value: vi.fn().mockResolvedValue(firstBytes) });
    Object.defineProperty(second, 'arrayBuffer', { value: vi.fn().mockResolvedValue(secondBytes) });
    const { unmount } = render(<FileRow file={source} initiallyShowUnlock onUnlock={vi.fn()} />);
    const picker = screen.getByLabelText('KeePass key file');
    fireEvent.change(picker, { target: { files: [first] } });
    await screen.findByText('first.key');
    fireEvent.change(picker, { target: { files: [second] } });
    await screen.findByText('second.key');
    expect(new Uint8Array(firstBytes)).toEqual(new Uint8Array(2));
    unmount();
    expect(new Uint8Array(secondBytes)).toEqual(new Uint8Array(2));
  });

  it('keeps the latest key file when an earlier read finishes later', async () => {
    const source: ImportFile = { name: 'race.kdbx', format: 'KeePass', status: 'unlock-required' };
    const staleBytes = new Uint8Array([1, 2]).buffer;
    const currentBytes = new Uint8Array([3, 4]).buffer;
    let finishFirst!: (bytes: ArrayBuffer) => void;
    const first = new File(['first'], 'first.key');
    const second = new File(['second'], 'second.key');
    Object.defineProperty(first, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishFirst = resolve;
        }),
    });
    Object.defineProperty(second, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(currentBytes),
    });
    const onUnlock = vi.fn();
    render(<FileRow file={source} initiallyShowUnlock onUnlock={onUnlock} />);
    const picker = screen.getByLabelText('KeePass key file');
    fireEvent.change(picker, { target: { files: [first] } });
    fireEvent.change(picker, { target: { files: [second] } });
    await screen.findByText('second.key');
    finishFirst(staleBytes);
    await waitFor(() => expect(new Uint8Array(staleBytes)).toEqual(new Uint8Array(2)));
    expect(screen.queryByText('first.key')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Unlock' })[1]);
    expect(onUnlock).toHaveBeenCalledWith(source, '', currentBytes);
  });

  it('wipes key file bytes if reading finishes after unmount', async () => {
    const source: ImportFile = { name: 'gone.kdbx', format: 'KeePass', status: 'unlock-required' };
    const bytes = new Uint8Array([5, 6]).buffer;
    let finishRead!: (bytes: ArrayBuffer) => void;
    const selected = new File(['key'], 'gone.key');
    Object.defineProperty(selected, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishRead = resolve;
        }),
    });
    const onUnlock = vi.fn();
    const { unmount } = render(<FileRow file={source} initiallyShowUnlock onUnlock={onUnlock} />);
    fireEvent.change(screen.getByLabelText('KeePass key file'), { target: { files: [selected] } });
    unmount();
    finishRead(bytes);
    await waitFor(() => expect(new Uint8Array(bytes)).toEqual(new Uint8Array(2)));
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('wipes a pending key file read when the source finishes', async () => {
    const source: ImportFile = { name: 'done.kdbx', format: 'KeePass', status: 'unlock-required' };
    const bytes = new Uint8Array([7, 8]).buffer;
    let finishRead!: (bytes: ArrayBuffer) => void;
    const selected = new File(['key'], 'done.key');
    Object.defineProperty(selected, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishRead = resolve;
        }),
    });
    const props = { initiallyShowUnlock: true, onUnlock: vi.fn() };
    const { rerender } = render(<FileRow file={source} {...props} />);
    fireEvent.change(screen.getByLabelText('KeePass key file'), { target: { files: [selected] } });
    rerender(<FileRow file={{ ...source, status: 'imported' }} {...props} />);
    finishRead(bytes);
    await waitFor(() => expect(new Uint8Array(bytes)).toEqual(new Uint8Array(2)));
  });

  it('keeps the Locked row and its factors mounted during an unlock attempt', async () => {
    const source: ImportFile = {
      id: 'locked',
      name: 'vault.kdbx',
      format: 'KeePass',
      status: 'unlock-required',
    };
    const bytes = new Uint8Array([1, 2]).buffer;
    const selected = new File(['key'], 'vault.key');
    Object.defineProperty(selected, 'arrayBuffer', { value: vi.fn().mockResolvedValue(bytes) });
    const onUnlock = vi.fn();
    const props = { onUnlock };
    const { rerender } = render(<SourceImportStatus files={[source]} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Locked 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    const passwordInput = screen.getByLabelText('Master password') as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText('KeePass key file'), { target: { files: [selected] } });
    await screen.findByText('vault.key');
    fireEvent.click(screen.getAllByRole('button', { name: 'Unlock' })[1]);
    expect(onUnlock).toHaveBeenCalledWith(source, 'wrong', bytes);

    rerender(<SourceImportStatus files={[{ ...source, status: 'unlocking' }]} {...props} />);
    expect(screen.getByRole('button', { name: 'Locked 1' })).toBeTruthy();
    expect(screen.getByLabelText('Master password')).toBe(passwordInput);
    expect((passwordInput as HTMLInputElement).value).toBe('wrong');
    expect(screen.getByText('vault.key')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Unlock' })[0].hasAttribute('disabled')).toBe(
      true,
    );

    rerender(<SourceImportStatus files={[source]} {...props} />);
    expect(screen.getByLabelText('Master password')).toBe(passwordInput);
    expect(screen.getByText('vault.key')).toBeTruthy();
    rerender(<SourceImportStatus files={[{ ...source, status: 'imported' }]} {...props} />);
    expect(screen.getByRole('button', { name: 'Locked 0' })).toBeTruthy();
    expect(screen.getByText('No sources match this filter.')).toBeTruthy();
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
