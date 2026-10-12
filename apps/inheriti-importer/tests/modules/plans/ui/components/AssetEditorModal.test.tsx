// @vitest-environment happy-dom
// See MappingWorkspace.test.tsx: components/assets eagerly loads Core's /core bundle,
// which needs happy-dom's globals (not jsdom's) under vitest.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssetEditorProvider } from '@modules/plans/ui/asset-editor';
import { AssetEditorModal } from '@modules/plans/ui/components/AssetEditorModal';

afterEach(cleanup);

describe('AssetEditorModal', () => {
  it('renders nothing for an unrecognised Asset Type', () => {
    const { container } = render(
      <AssetEditorModal open type="NOT-A-REAL-TYPE" onSave={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders the plain-text form for PLAIN-TEXT and saves the entered value', async () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(<AssetEditorModal open type="PLAIN-TEXT" onSave={onSave} onDismiss={onDismiss} />);

    fireEvent.change(screen.getByLabelText('Asset name'), { target: { value: 'My note' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'remember the milk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      type: 'PLAIN-TEXT',
      meta: { name: 'My note' },
      secret: { text: 'remember the milk' },
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders the typed field set for a standard Asset Type (USER-PSWD)', () => {
    render(<AssetEditorModal open type="USER-PSWD" onSave={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByLabelText('Asset name')).toBeTruthy();
    expect(screen.getByLabelText('username')).toBeTruthy();
    expect(screen.getByLabelText('password')).toBeTruthy();
  });

  it('pre-fills the form when editing an existing Asset', () => {
    render(
      <AssetEditorModal
        open
        type="USER-PSWD"
        asset={{
          id: 'a1',
          type: 'USER-PSWD',
          meta: { name: 'GitHub' },
          secret: { username: 'octo', password: 'hunter2' },
        }}
        onSave={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('Asset name') as HTMLInputElement).value).toBe('GitHub');
    expect((screen.getByLabelText('username') as HTMLInputElement).value).toBe('octo');
  });

  it('closes via the header close action, by mouse and by keyboard', () => {
    const onDismiss = vi.fn();
    render(<AssetEditorModal open type="PLAIN-TEXT" onSave={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close asset editor' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    onDismiss.mockClear();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close asset editor' }), { key: 'Enter' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders a Cancel action that dismisses without saving', () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(<AssetEditorModal open type="PLAIN-TEXT" onSave={onSave} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders the media form (usage bar + file picker) for a media Asset Type, gated behind AssetEditorProvider', async () => {
    const selectFile = vi.fn().mockResolvedValue({
      data: new Blob(['x']),
      fileName: 'a.png',
      mimeType: 'image/png',
      size: 1,
    });
    render(
      <AssetEditorProvider t={(key: string) => key} selectFile={selectFile}>
        <AssetEditorModal open type="IMAGE" onSave={vi.fn()} onDismiss={vi.fn()} />
      </AssetEditorProvider>,
    );
    expect(screen.getByText(/Usage:/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Select IMAGE file/ }));
    await waitFor(() => expect(selectFile).toHaveBeenCalledTimes(1));
  });

  it('shows a loading state on the file picker while a media selection is in flight', async () => {
    let resolveSelect!: (value: {
      data: Blob;
      fileName: string;
      mimeType: string;
      size: number;
    }) => void;
    const selectFile = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSelect = resolve;
        }),
    );
    render(
      <AssetEditorProvider t={(key: string) => key} selectFile={selectFile}>
        <AssetEditorModal open type="IMAGE" onSave={vi.fn()} onDismiss={vi.fn()} />
      </AssetEditorProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Select IMAGE file/ }));
    expect(screen.getByText('Selecting file…')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Select IMAGE file/ })).toHaveProperty(
      'disabled',
      true,
    );

    resolveSelect({ data: new Blob(['x']), fileName: 'a.png', mimeType: 'image/png', size: 1 });
    await waitFor(() => expect(screen.getByText('a.png')).toBeTruthy());
  });
});
