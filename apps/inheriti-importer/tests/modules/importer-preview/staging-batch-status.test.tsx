import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StagingBatchStatus } from '@modules/importer-preview/StagingBatchStatus';
import { FinalStagingChecklist } from '@modules/importer-preview/FinalStagingChecklist';
import { Button } from '@main-components';
import { parserGuidance } from '@modules/import/application/parser-guidance';

afterEach(cleanup);

describe('StagingBatchStatus', () => {
  it('keeps failed, cancelled and not staged outcomes visible in embedded bars', () => {
    const onRetryConfigure = vi.fn();
    render(
      <StagingBatchStatus
        embedded
        items={[
          { planId: 'a', status: 'FAILED_CONFIGURE' },
          { planId: 'b', status: 'CANCELLED' },
          { planId: 'c', status: 'CREATED' },
        ]}
        plans={[
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
          { id: 'c', name: 'Gamma' },
        ]}
        running={false}
        onRetryCreate={vi.fn()}
        onRetryConfigure={onRetryConfigure}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Alpha · Staging failed')).toBeTruthy();
    expect(screen.getByText('Beta · Cancelled')).toBeTruthy();
    expect(screen.getByText('Gamma · Not staged')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry staging' })[0]!);
    expect(onRetryConfigure).toHaveBeenCalledWith('a');
  });
  it('places the running batch directly in the active card with one header cancel action', () => {
    const onCancel = vi.fn();
    render(
      <FinalStagingChecklist
        state="encrypting"
        items={[
          { label: 'Load Organisation Key', detail: 'Key securely loaded.', complete: true },
          { label: 'Secure staging', detail: 'Encrypting data.', complete: false, loading: true },
        ]}
        planProgress
        secureHeaderAction={<Button title="Cancel staging" onPress={onCancel} />}
        progress={
          <StagingBatchStatus
            embedded
            items={[
              { planId: 'a', status: 'COMPLETE' },
              { planId: 'b', status: 'CONFIGURING' },
            ]}
            plans={[
              { id: 'a', name: 'Alpha' },
              { id: 'b', name: 'Beta' },
            ]}
            running
            onRetryCreate={vi.fn()}
            onRetryConfigure={vi.fn()}
            onCancel={onCancel}
          />
        }
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Cancel staging' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Staging…' })).toBeNull();
    expect(
      screen.getByRole('progressbar', { name: 'Alpha: Staged' }).getAttribute('aria-valuenow'),
    ).toBe('100');
    expect(
      screen.getByRole('progressbar', { name: 'Beta: Staging' }).getAttribute('aria-valuenow'),
    ).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Beta: Staging' }).getAttribute('title')).toBe(
      'Beta: Staging',
    );
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel staging' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
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
    expect(screen.getByText('Beta · Staging failed')).toBeTruthy();
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
