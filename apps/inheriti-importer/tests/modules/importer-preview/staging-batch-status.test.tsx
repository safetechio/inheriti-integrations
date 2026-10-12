import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StagingBatchStatus } from '@modules/importer-preview/StagingBatchStatus';
import { parserGuidance } from '@modules/import/application/parser-guidance';

afterEach(cleanup);

describe('StagingBatchStatus', () => {
  it('hides the redundant batch summary after every Plan is staged', () => {
    const { container } = render(
      <StagingBatchStatus
        items={[
          { planId: 'a', status: 'COMPLETE' },
          { planId: 'b', status: 'COMPLETE' },
        ]}
        plans={[
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ]}
        running={false}
        onRetryCreate={vi.fn()}
        onRetryConfigure={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('uses importer outcomes and routes each failed Plan to its targeted retry', () => {
    const onRetryCreate = vi.fn();
    const onRetryConfigure = vi.fn();
    render(
      <StagingBatchStatus
        items={[
          { planId: 'a', status: 'COMPLETE' },
          { planId: 'b', status: 'FAILED_CREATE' },
          { planId: 'c', status: 'FAILED_CONFIGURE' },
        ]}
        plans={[
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
          { id: 'c', name: 'Gamma' },
        ]}
        running={false}
        onRetryCreate={onRetryCreate}
        onRetryConfigure={onRetryConfigure}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Alpha · Staged')).toBeTruthy();
    expect(screen.getByText('Beta · Not staged')).toBeTruthy();
    expect(screen.queryByText(/created|configured/i)).toBeNull();
    const retries = screen.getAllByRole('button', { name: 'Retry staging' });
    fireEvent.click(retries[0]!);
    fireEvent.click(retries[1]!);
    expect(onRetryCreate).toHaveBeenCalledWith('b');
    expect(onRetryConfigure).toHaveBeenCalledWith('c');
  });

  it('shows current, pending, cancellation state and a cancel action', () => {
    const onCancel = vi.fn();
    render(
      <StagingBatchStatus
        items={[
          { planId: 'a', status: 'CONFIGURING' },
          { planId: 'b', status: 'PENDING' },
          { planId: 'c', status: 'CANCELLED' },
        ]}
        plans={[
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
          { id: 'c', name: 'Gamma' },
        ]}
        running
        onRetryCreate={vi.fn()}
        onRetryConfigure={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText('Current: Alpha · Pending: 1 · Cancelled: 1')).toBeTruthy();
    expect(screen.getByText('Gamma · Cancelled')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel staging' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows locally prepared Plans as not staged after execution stops', () => {
    render(
      <StagingBatchStatus
        items={[{ planId: 'a', status: 'CREATED' }]}
        plans={[{ id: 'a', name: 'Alpha' }]}
        running={false}
        onRetryCreate={vi.fn()}
        onRetryConfigure={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Alpha · Not staged')).toBeTruthy();
    expect(screen.getByText('Pending: 1')).toBeTruthy();
    expect(screen.queryByText(/Current:/)).toBeNull();
  });
});

describe('parserGuidance', () => {
  it('turns known wrong export shapes into actionable guidance', () => {
    expect(parserGuidance('No cloud secrets were found.')).toMatch(/value-bearing/);
    expect(parserGuidance('Unrelated parser error')).toBeNull();
  });
});
