import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Icon } from '@modules/_shared/ui/components/Base/Icon';
import { BaseModal } from '@modules/_shared/ui/components/Base/Modal';
import { Text } from '@modules/_shared/ui/components/Primitives';
import { theme } from '@modules/_shared/ui/theme/AppTheme';
import { PlanAvatar } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/components/PlanAvatar';

afterEach(cleanup);

function renderModal(titleIcon?: ReactNode) {
  render(
    <BaseModal visible title="Move folder" description="Choose a destination." titleIcon={titleIcon} onDismiss={vi.fn()}>
      <Text>Folder list</Text>
    </BaseModal>,
  );
  const title = screen.getByText('Move folder');
  expect(screen.getByText('Choose a destination.').parentElement).toBe(title.parentElement);
  return title.parentElement!;
}

function cssColor(color: string) {
  const element = document.createElement('div');
  element.style.color = color;
  return element.style.color;
}

describe('BaseModal header', () => {
  it('places the description below the title beside the primary icon badge', () => {
    const textColumn = renderModal(<Icon name="folder" color="primary" />);
    const icon = screen.getByLabelText('folder');
    const badge = icon.parentElement!;
    expect(textColumn.previousElementSibling).toBe(badge);
    const badgeStyle = getComputedStyle(badge);
    expect(badgeStyle.backgroundColor).toBe(cssColor(theme.colors.primary4));
    expect(badgeStyle.borderTopColor).toBe(cssColor(theme.colors.primary10));
    expect(badgeStyle.borderTopWidth).toBe('1px');
    expect(badgeStyle.borderTopLeftRadius).toBe(`${theme.radii.pill}px`);
    expect(badgeStyle.width).toBe('40px');
    expect(badgeStyle.height).toBe('40px');
    expect(getComputedStyle(icon).color).toBe(cssColor(theme.colors.primary));
    const close = screen.getByRole('button', { name: 'Close Move folder' });
    expect(textColumn.parentElement?.nextElementSibling).toBe(close);
  });

  it('renders the plan avatar directly beside the text column', () => {
    const textColumn = renderModal(<PlanAvatar id="draft" />);
    expect(textColumn.previousElementSibling).toBe(screen.getByRole('img', { name: 'Plan avatar' }).closest('.plan-mosaic'));
  });

  it('starts the text column at the header edge when there is no icon', () => {
    const textColumn = renderModal();
    expect(textColumn.previousElementSibling).toBeNull();
  });
});
