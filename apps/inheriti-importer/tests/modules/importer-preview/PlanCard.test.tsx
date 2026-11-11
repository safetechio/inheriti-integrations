import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PlanCard } from '@modules/importer-preview/PlanGroupingSurface/components/PlanCard';

afterEach(cleanup);

it('shows empty draft review only after selection moves away', () => {
  const plan = { id: 'draft', name: 'Draft', assets: 0, capacity: '10', valid: false };
  const props = {
    plan,
    selected: true,
    onSelect: () => {},
    dropState: 'idle' as const,
    onDragOver: () => {},
    onDragLeave: () => {},
    onDrop: () => {},
  };
  const { rerender, container } = render(<PlanCard {...props} />);
  expect(screen.queryByText('Needs review')).toBeNull();
  expect(screen.queryByText('Add at least one Asset to this draft plan.')).toBeNull();

  rerender(<PlanCard {...props} selected={false} />);
  expect(screen.getByText('Needs review')).toBeTruthy();
  const helper = screen.getByText('Add at least one Asset to this draft plan.');
  expect(helper.closest('.plan-drop-zone')).toBeNull();
  expect(container.querySelector('.plan-drop-zone')?.textContent).toBe('Drag an Asset here');
});
