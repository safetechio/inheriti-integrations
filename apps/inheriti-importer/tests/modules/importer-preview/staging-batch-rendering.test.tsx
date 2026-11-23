import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  projectStagingBatch,
  StagingBatchStatus,
  type StagingBatchStatusProps,
} from '@modules/importer-preview/StagingBatchStatus';

const renderProgress = vi.hoisted(() => vi.fn());

vi.mock('@main-components', async (importOriginal) => {
  const components = await importOriginal<typeof import('@main-components')>();
  return {
    ...components,
    Box: (props: ComponentProps<typeof components.Box>) => {
      if (props.accessibilityRole === 'progressbar') renderProgress(props.accessibilityLabel);
      return <components.Box {...props} />;
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const props: StagingBatchStatusProps = {
  plans: [
    { id: 'first', name: 'First' },
    { id: 'second', name: 'Second' },
  ],
  items: [
    { planId: 'first', status: 'CONFIGURING' },
    { planId: 'second', status: 'FAILED_CREATE' },
  ],
  running: true,
  onCancel: vi.fn(),
  onRetryCreate: vi.fn(),
  onRetryConfigure: vi.fn(),
};

it('updates changing progress rows while leaving equivalent rows memoized', () => {
  const view = render(<StagingBatchStatus {...props} />);
  expect(
    screen.getByRole('progressbar', { name: 'First: Staging' }).hasAttribute('aria-valuenow'),
  ).toBe(false);
  expect(screen.getByRole('button', { name: 'Retry staging' }).getAttribute('aria-disabled')).toBe(
    'true',
  );
  renderProgress.mockClear();

  view.rerender(
    <StagingBatchStatus
      {...props}
      onRetryCreate={vi.fn()}
      items={[{ planId: 'first', status: 'COMPLETE' }, { ...props.items[1]! }]}
    />,
  );

  expect(screen.getByText('1 of 2 plans staged')).toBeTruthy();
  const staged = screen.getByRole('progressbar', { name: 'First: Staged' });
  expect(staged.getAttribute('aria-valuenow')).toBe('100');
  expect(staged.getAttribute('aria-valuetext')).toBe('Staged');
  expect(renderProgress).toHaveBeenCalledExactlyOnceWith('First: Staged');
});

it('routes each retry to the latest handler even when its row props stay equivalent', () => {
  const items = [
    { planId: 'first', status: 'FAILED_CONFIGURE' },
    { planId: 'second', status: 'FAILED_CREATE' },
  ];
  const view = render(<StagingBatchStatus {...props} items={items} running={false} />);
  const onRetryCreate = vi.fn();
  const onRetryConfigure = vi.fn();
  view.rerender(
    <StagingBatchStatus
      {...props}
      items={items}
      running={false}
      onRetryCreate={onRetryCreate}
      onRetryConfigure={onRetryConfigure}
    />,
  );
  screen
    .getAllByRole('button', { name: 'Retry staging' })
    .forEach((button) => fireEvent.click(button));
  expect(onRetryConfigure).toHaveBeenCalledExactlyOnceWith('first');
  expect(onRetryCreate).toHaveBeenCalledExactlyOnceWith('second');
  expect(props.onRetryConfigure).not.toHaveBeenCalled();
  expect(props.onRetryCreate).not.toHaveBeenCalled();
});

it('hides empty batches and fully staged batches after staging stops', () => {
  const view = render(<StagingBatchStatus {...props} items={[]} />);
  expect(view.container.firstChild).toBeNull();

  const items = [{ planId: 'first', status: 'COMPLETE' }];
  view.rerender(<StagingBatchStatus {...props} items={items} />);
  expect(screen.getByText('1 of 1 plan staged')).toBeTruthy();
  view.rerender(<StagingBatchStatus {...props} items={items} running={false} />);
  expect(view.container.firstChild).toBeNull();
});

it('uses the first matching plan name and falls back to the ID for missing plans', () => {
  const batch = projectStagingBatch(
    [
      { planId: 'first', status: 'CREATED' },
      { planId: 'missing', status: 'CANCELLED' },
    ],
    [...props.plans, { id: 'first', name: 'Duplicate' }],
  );
  expect(batch.plans).toEqual([
    { planId: 'first', name: 'First', outcome: 'Not staged', retry: 'configure' },
    { planId: 'missing', name: 'missing', outcome: 'Cancelled', retry: null },
  ]);
  expect(batch).toMatchObject({ completed: 0, current: null, pending: 1, cancelled: 1 });
});
