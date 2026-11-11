import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { OpenedVaultFile } from '@modules/import/domain/vault';

const openedFile: OpenedVaultFile = {
  name: 'secrets.json',
  data: new ArrayBuffer(0),
};
const filesFromList = vi.fn().mockResolvedValue([openedFile]);

vi.mock('@shared/infrastructure/files', () => ({
  filesFromList: (...args: unknown[]) => filesFromList(...args),
  openVaultFiles: vi.fn().mockResolvedValue([]),
}));

import { ImportPanel } from '@modules/import/ui/components/ImportPanel';

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

  it('imports a dropped file exactly once', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<ImportPanel busy={false} error={null} onImport={onImport} />);
    const dropzone = container.querySelector('.dropzone');
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [new File(['secret'], 'secrets.json')] },
    });

    dropzone?.dispatchEvent(dropEvent);

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith([openedFile]);
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
    const dropzone = container.querySelector('.dropzone');
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [new File(['secret'], 'secrets.json')] },
    });
    dropzone?.dispatchEvent(dropEvent);
    fireEvent.click(getByText('Choose files'));
    expect(getByText('Checking organisation access…')).toBeTruthy();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Checking organisation access…',
    );
    expect(container.querySelector('.dropzone > div')?.getAttribute('style')).toContain(
      'opacity: 0.35',
    );
    expect(filesFromList).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('keeps import content fully visible when enabled', () => {
    const { container } = render(<ImportPanel busy={false} error={null} onImport={vi.fn()} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('.dropzone > div')?.getAttribute('style')).toContain(
      'opacity: 1',
    );
  });
});
