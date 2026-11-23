import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { OpenedVaultFile } from '@modules/import/domain/vault';

const openedFile: OpenedVaultFile = {
  name: 'secrets.json',
  data: new ArrayBuffer(0),
};
const filesFromList = vi.fn().mockResolvedValue([openedFile]);
const openVaultFiles = vi.fn().mockResolvedValue([]);

vi.mock('@shared/infrastructure/files', () => ({
  filesFromList: (...args: unknown[]) => filesFromList(...args),
  openVaultFiles: () => openVaultFiles(),
}));

import { ImportPanel } from '@modules/import/ui/components/ImportPanel';

function drag(target: Element, type: string, dataTransfer: object) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  fireEvent(target, event);
  return event;
}

function dropFile(container: HTMLElement, target = '.empty-layout') {
  return drag(container.querySelector(target)!, 'drop', {
    types: ['Files'],
    files: [new File(['fixture'], 'secrets.json')],
  });
}

function holdFileRead() {
  let finish!: (files: OpenedVaultFile[]) => void;
  filesFromList.mockReturnValueOnce(
    new Promise<OpenedVaultFile[]>((resolve) => (finish = resolve)),
  );
  return () => act(async () => finish([openedFile]));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ImportPanel', () => {
  it('lists 1Password .1pux exports as a source', () => {
    const { getByText } = render(<ImportPanel busy={false} error={null} onImport={vi.fn()} />);
    expect(getByText('1Password')).toBeTruthy();
    expect(getByText('.1pux export')).toBeTruthy();
    expect(
      getByText('Import text fields from a 1Password export for review and editing.'),
    ).toBeTruthy();
  });

  it.each(['.empty-layout', '.source-card'])(
    'imports a file dropped on %s exactly once',
    async (target) => {
      const onImport = vi.fn().mockResolvedValue(undefined);
      const { container } = render(<ImportPanel busy={false} error={null} onImport={onImport} />);

      expect(dropFile(container, target).defaultPrevented).toBe(true);

      await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
      expect(filesFromList).toHaveBeenCalledTimes(1);
      expect(onImport).toHaveBeenCalledWith([openedFile]);
    },
  );

  it('highlights the card for a file drag over the full surface and leaves text drags alone', () => {
    const { container } = render(<ImportPanel busy={false} error={null} onImport={vi.fn()} />);
    const surface = container.querySelector('.empty-layout')!;
    const card = container.querySelector('.dropzone')!;
    const textTransfer = { types: ['text/plain'], files: [] };
    expect(drag(surface, 'dragover', textTransfer).defaultPrevented).toBe(false);
    expect(drag(surface, 'drop', textTransfer).defaultPrevented).toBe(false);
    expect(card.classList.contains('over')).toBe(false);

    const fileTransfer = { types: ['Files'], files: [], dropEffect: 'none' };
    expect(drag(surface, 'dragover', fileTransfer).defaultPrevented).toBe(true);
    expect(fileTransfer.dropEffect).toBe('copy');
    expect(card.classList.contains('over')).toBe(true);
  });

  it('keeps file picker and drop import disabled while organisation access is unresolved', async () => {
    const onImport = vi.fn();
    const { container, getByText } = render(
      <ImportPanel
        busy={false}
        disabled
        notice="Checking organisation access…"
        error={null}
        onImport={onImport}
      />,
    );
    expect(dropFile(container).defaultPrevented).toBe(true);
    fireEvent.click(getByText('Choose files'));
    expect(getByText('Checking organisation access…')).toBeTruthy();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Checking organisation access…',
    );
    expect(container.querySelector('.dropzone > div')?.getAttribute('style')).toContain(
      'opacity: 0.35',
    );
    expect(filesFromList).not.toHaveBeenCalled();
    expect(openVaultFiles).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('prevents navigation and ignores files while an import is busy', () => {
    const onImport = vi.fn();
    const { container } = render(<ImportPanel busy error={null} onImport={onImport} />);
    expect(dropFile(container).defaultPrevented).toBe(true);
    expect(filesFromList).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('uses the latest enabled callback for a new drop', async () => {
    const previous = vi.fn();
    const current = vi.fn();
    const { container, rerender } = render(
      <ImportPanel disabled busy={false} error={null} onImport={previous} />,
    );
    rerender(<ImportPanel busy={false} error={null} onImport={current} />);
    dropFile(container);
    await waitFor(() => expect(current).toHaveBeenCalledWith([openedFile]));
    expect(previous).not.toHaveBeenCalled();
  });

  it('shows a recovery message when a dropped file cannot be read and accepts a retry', async () => {
    const onImport = vi.fn();
    filesFromList.mockRejectedValueOnce(new Error('read failed'));
    const { container, findByText, queryByText } = render(
      <ImportPanel busy={false} error={null} onImport={onImport} />,
    );
    dropFile(container);
    const message = 'Could not open the files. Drop them again or use Choose files.';
    await findByText(message);
    expect(onImport).not.toHaveBeenCalled();
    dropFile(container);
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(queryByText(message)).toBeNull();
  });

  it('blocks duplicate reads and the picker while a drop is opening', async () => {
    const finishRead = holdFileRead();
    const onImport = vi.fn();
    const { container, getByRole } = render(
      <ImportPanel busy={false} error={null} onImport={onImport} />,
    );
    dropFile(container);
    dropFile(container, '.source-card');
    fireEvent.click(getByRole('button', { name: 'Opening…' }));
    expect(filesFromList).toHaveBeenCalledTimes(1);
    expect(openVaultFiles).not.toHaveBeenCalled();
    await finishRead();
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('imports selected files through Choose files', async () => {
    const onImport = vi.fn();
    openVaultFiles.mockResolvedValueOnce([openedFile]);
    const { getByRole } = render(<ImportPanel busy={false} error={null} onImport={onImport} />);
    fireEvent.click(getByRole('button', { name: 'Choose files' }));
    await waitFor(() => expect(onImport).toHaveBeenCalledExactlyOnceWith([openedFile]));
  });

  it('accepts drops after a browser picker stops without selecting files', async () => {
    const onImport = vi.fn();
    openVaultFiles.mockReturnValueOnce(new Promise(() => {}));
    const { container, getByRole } = render(
      <ImportPanel busy={false} error={null} onImport={onImport} />,
    );
    fireEvent.click(getByRole('button', { name: 'Choose files' }));
    dropFile(container);
    await waitFor(() => expect(onImport).toHaveBeenCalledExactlyOnceWith([openedFile]));
  });

  it('discards a pending read when organisation access is disabled, even if it returns', async () => {
    const finishRead = holdFileRead();
    const onImport = vi.fn();
    const { container, rerender } = render(
      <ImportPanel busy={false} error={null} onImport={onImport} />,
    );
    dropFile(container);
    rerender(<ImportPanel busy={false} disabled error={null} onImport={onImport} />);
    rerender(<ImportPanel busy={false} error={null} onImport={onImport} />);
    await finishRead();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('uses the latest callback when a read finishes while import stays enabled', async () => {
    const finishRead = holdFileRead();
    const previous = vi.fn();
    const current = vi.fn();
    const { container, rerender } = render(
      <ImportPanel busy={false} error={null} onImport={previous} />,
    );
    dropFile(container);
    rerender(<ImportPanel busy={false} error={null} onImport={current} />);
    await finishRead();
    expect(previous).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledExactlyOnceWith([openedFile]);
  });

  it('discards a pending read when the panel remounts for another organisation', async () => {
    const finishRead = holdFileRead();
    const previous = vi.fn();
    const current = vi.fn();
    const { container, rerender } = render(
      <ImportPanel key="first" busy={false} error={null} onImport={previous} />,
    );
    dropFile(container);
    rerender(<ImportPanel key="second" busy={false} error={null} onImport={current} />);
    await finishRead();
    expect(previous).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    dropFile(container);
    await waitFor(() => expect(current).toHaveBeenCalledExactlyOnceWith([openedFile]));
  });

  it('keeps import content fully visible when enabled', () => {
    const { container } = render(<ImportPanel busy={false} error={null} onImport={vi.fn()} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('.dropzone > div')?.getAttribute('style')).toContain(
      'opacity: 1',
    );
  });
});
