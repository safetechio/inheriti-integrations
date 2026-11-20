import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SelectionHelpPopover } from '@modules/importer-preview/PlanGroupingSurface/components/SelectionHelpPopover';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('selection help', () => {
  it('opens on hover and remains available while moving into the popover', () => {
    vi.useFakeTimers();
    render(<SelectionHelpPopover kind="assets" />);
    const trigger = screen.getByRole('button', { name: 'Unassigned asset selection help' });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByText('Asset controls')).toBeTruthy();
    expect(screen.getByText(/Ctrl\/Cmd\+drag to select assets/)).toBeTruthy();
    expect(screen.getAllByText(/^[1-4]$/)).toHaveLength(4);
    expect(screen.getAllByRole('heading')).toHaveLength(4);
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(screen.getByRole('tooltip'));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('click pins and toggles; Escape and outside click dismiss', () => {
    render(<SelectionHelpPopover kind="organisation" />);
    const trigger = screen.getByRole('button', { name: 'Organisation tree selection help' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Organisation controls')).toBeTruthy();
    expect(screen.getByText(/Click a plan title to open it/)).toBeTruthy();
    expect(screen.getAllByText(/^[1-4]$/)).toHaveLength(4);
    expect(screen.getAllByRole('heading')).toHaveLength(4);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
