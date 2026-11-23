import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ImporterFlow, type ImporterFlowProps } from '@modules/importer-preview/ImporterFlow';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem('importer.quick-guide.dismissed.assets.v1');
  localStorage.removeItem('importer.quick-guide.dismissed.plans.v1');
});

const flow: ImporterFlowProps = {
  files: [],
  assets: [],
  unassigned: [],
  plans: [],
  checklist: [],
  autoAdvance: false,
};

const button = (name: string) => screen.getByRole('button', { name });

function openGuide() {
  const opener = button('Quick guide');
  opener.focus();
  fireEvent.click(opener);
  return screen.getByRole('dialog', { name: /Quick guide/ });
}

function illustration() {
  return screen.getByRole('dialog').querySelector('.quick-guide-illustration');
}

describe('Importer Quick guide', () => {
  it.each(['sources', 'staging'] as const)('is absent from the %s stage', (initialStage) => {
    render(<ImporterFlow {...flow} initialStage={initialStage} />);
    expect(screen.queryByRole('button', { name: 'Quick guide' })).toBeNull();
  });

  it('opens on demand before Cancel import and returns focus after Done', async () => {
    const onCancel = vi.fn();
    const onReviewAsset = vi.fn();
    const onAcceptAllEligible = vi.fn(() => 0);
    render(
      <ImporterFlow
        {...flow}
        initialStage="assets"
        callbacks={{ onCancel, onReviewAsset, onAcceptAllEligible }}
        assets={[
          {
            id: 'asset-1',
            name: 'Current import asset',
            type: 'USER-PSWD',
            status: 'suggested',
            confidence: 'High confidence',
            rationale: '',
            mapped: [],
            unmapped: [],
            source: 'sample.kdbx',
            alternatives: ['PLAIN-TEXT'],
          },
        ]}
      />,
    );

    const opener = button('Quick guide');
    expect(
      opener.compareDocumentPosition(button('Cancel import')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = within(openGuide());
    expect(dialog.queryByText('Current import asset')).toBeNull();
    expect(dialog.getByRole('heading', { name: 'Check where fields go' })).toBeTruthy();
    expect(dialog.getByText('1 of 3')).toBeTruthy();
    expect(
      screen.getByRole('dialog').querySelector('.quick-guide-caption')?.textContent,
    ).not.toContain('**');
    expect(dialog.getByRole('button', { name: 'Previous' }).getAttribute('aria-disabled')).toBe(
      'true',
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(button('Close Quick guide · Review assets')),
    );
    for (const key of ['a', 'x']) fireEvent.keyDown(document.activeElement!, { key });
    fireEvent.keyDown(document.activeElement!, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'a', ctrlKey: true, shiftKey: true });

    fireEvent.click(button('Next'));
    expect(dialog.getByRole('heading', { name: 'Create assets from pending fields' })).toBeTruthy();
    fireEvent.click(button('Previous'));
    expect(dialog.getByText('1 of 3')).toBeTruthy();
    fireEvent.click(button('Next'));
    fireEvent.click(button('Next'));
    expect(dialog.getByRole('heading', { name: 'Accept assets together' })).toBeTruthy();
    expect(dialog.getByText('3 of 3')).toBeTruthy();
    fireEvent.click(button('Done'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onReviewAsset).not.toHaveBeenCalled();
    expect(onAcceptAllEligible).not.toHaveBeenCalled();
  });

  it('keeps paused state across cards, replays and closes with Escape or Close', async () => {
    render(<ImporterFlow {...flow} initialStage="plans" />);
    const opener = button('Quick guide');
    const dialog = openGuide();
    expect(dialog.getAttribute('aria-label')).toBe('Quick guide · Create plans');
    expect(
      within(dialog).getByRole('heading', { name: 'Organise your organisation folders' }),
    ).toBeTruthy();
    fireEvent.click(button('Pause'));
    expect(illustration()?.classList.contains('is-paused')).toBe(true);
    const sceneShell = dialog.querySelector('.quick-guide-scene-shell');
    const firstScene = dialog.querySelector('.quick-guide-scene-content');
    expect(sceneShell?.contains(firstScene)).toBe(true);
    const firstDot = button('Show scene 1: Organise your organisation folders');
    const secondDot = button('Show scene 2: Create a plan from selected assets');
    expect(firstDot.getAttribute('aria-current')).toBe('step');
    fireEvent.keyDown(secondDot, { key: 'Enter' });
    expect(firstDot.getAttribute('aria-current')).toBeNull();
    expect(secondDot.getAttribute('aria-current')).toBe('step');
    expect(dialog.querySelector('.quick-guide-scene-shell')).toBe(sceneShell);
    expect(dialog.querySelector('.quick-guide-scene-content')).not.toBe(firstScene);
    expect(
      within(dialog).getByRole('heading', { name: 'Create a plan from selected assets' }),
    ).toBeTruthy();
    expect(illustration()?.classList.contains('is-paused')).toBe(true);
    fireEvent.click(button('Play'));
    expect(illustration()?.classList.contains('is-paused')).toBe(false);
    fireEvent.click(button('Show scene 5: Unassign an asset and undo'));
    expect(
      within(dialog).getByRole('heading', { name: 'Unassign an asset and undo' }),
    ).toBeTruthy();

    const original = illustration();
    fireEvent.click(button('Replay'));
    expect(illustration()).not.toBe(original);
    expect(dialog.querySelectorAll('.quick-guide-illustration')).toHaveLength(1);
    fireEvent.keyDown(button('Replay'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);

    openGuide();
    expect(screen.getByText('1 of 5')).toBeTruthy();
    fireEvent.click(button('Close Quick guide · Create plans'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it.each(['assets', 'plans'] as const)(
    'demonstrates gestures without adding fake controls to the tab order in %s',
    (initialStage) => {
      render(<ImporterFlow {...flow} initialStage={initialStage} />);
      const dialog = openGuide();
      const count = initialStage === 'plans' ? 5 : 3;
      for (let index = 0; index < count; index += 1) {
        expect(illustration()?.querySelector('.quick-guide-demo-cursor')).toBeTruthy();
        expect(illustration()?.querySelector('.quick-guide-demo-control')).toBeTruthy();
        for (const row of illustration()!.querySelectorAll('.quick-guide-row')) {
          expect(row.querySelectorAll('[aria-label="square-check"]').length).toBeLessThanOrEqual(1);
        }
        expect(illustration()?.querySelector('[role="button"], button, [tabindex="0"]')).toBeNull();
        if (index < count - 1)
          fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
      }
    },
  );

  it('shows a completed assignment summary when no assets remain unassigned', () => {
    render(
      <ImporterFlow
        {...flow}
        initialStage="plans"
        plans={[
          { id: 'plan', name: 'Access plan', assets: 2, capacity: '2 of 10 assets', valid: true },
        ]}
      />,
    );
    expect(screen.getByText('1 draft plan · All assets assigned')).toBeTruthy();
    expect(screen.queryByText(/0 assets still unassigned/)).toBeNull();
  });

  it('shows selection, New plan and inline naming without a confirmation modal', () => {
    render(<ImporterFlow {...flow} initialStage="plans" />);
    openGuide();
    fireEvent.click(button('Show scene 2: Create a plan from selected assets'));
    const art = illustration()!;
    expect(art.classList.contains('gesture-new-plan')).toBe(true);
    expect(
      art.querySelector('.quick-guide-frame:nth-child(2) .quick-guide-demo-control')?.textContent,
    ).toBe('New plan');
    expect(
      art.querySelector('.quick-guide-frame:nth-child(3) .quick-guide-pane:first-child')
        ?.textContent,
    ).toContain('1 asset still unassigned');
    expect(
      art.querySelectorAll(
        '.quick-guide-frame:nth-child(3) .quick-guide-pane:last-child .quick-guide-row',
      ),
    ).toHaveLength(2);
    expect(art.querySelector('.quick-guide-plan-name-editor')).toBeTruthy();
    expect(art.querySelector('.quick-guide-create-preview')).toBeNull();
  });

  it('opens once per step, remembers Skip, fades out and remains available manually', async () => {
    const first = render(
      <ImporterFlow {...flow} initialStage="assets" showQuickGuideOnFirstVisit />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(button('Skip'));
    expect(document.querySelector('.quick-guide-modal.is-closing')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(localStorage.getItem('importer.quick-guide.dismissed.assets.v1')).toBe('1');
    first.unmount();
    const returning = render(
      <ImporterFlow {...flow} initialStage="assets" showQuickGuideOnFirstVisit />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    openGuide();
    expect(screen.getByRole('dialog')).toBeTruthy();
    returning.unmount();
    render(<ImporterFlow {...flow} initialStage="plans" showQuickGuideOnFirstVisit />);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(
      'Quick guide · Create plans',
    );
    expect(screen.getByText('1 of 5')).toBeTruthy();
  });

  it('resets the guide when the flow changes stage', () => {
    render(<ImporterFlow {...flow} initialStage="plans" />);
    openGuide();
    fireEvent.click(button('Next'));
    fireEvent.click(button('Back'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(openGuide().getAttribute('aria-label')).toBe('Quick guide · Review assets');
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('shows the static result and keeps focus in the guide when reduced motion changes', async () => {
    const media = Object.assign(new EventTarget(), { matches: true });
    const unsubscribe = vi.spyOn(media, 'removeEventListener');
    vi.stubGlobal('matchMedia', () => media);
    render(<ImporterFlow {...flow} initialStage="assets" />);
    openGuide();
    const close = button('Close Quick guide · Review assets');
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(illustration()?.classList.contains('is-static')).toBe(true);
    expect(illustration()?.querySelector('.quick-guide-gesture')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    act(() => {
      media.matches = false;
      media.dispatchEvent(new Event('change'));
    });
    expect(illustration()?.classList.contains('is-static')).toBe(false);
    expect(button('Pause')).toBeTruthy();

    fireEvent.click(button('Next'));
    button('Replay').focus();
    act(() => {
      media.matches = true;
      media.dispatchEvent(new Event('change'));
    });
    expect(illustration()?.classList.contains('is-static')).toBe(true);
    expect(document.activeElement).toBe(button('Show scene 2: Create assets from pending fields'));

    act(() => {
      media.matches = false;
      media.dispatchEvent(new Event('change'));
    });
    close.focus();
    act(() => {
      media.matches = true;
      media.dispatchEvent(new Event('change'));
    });
    expect(document.activeElement).toBe(close);

    fireEvent.click(close);
    expect(unsubscribe).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
