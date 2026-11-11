import { render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import {
  AccountMenuOpen,
  Landing,
  OrganizationMenuOpen,
} from '../../src/stories/importer-preview/ShellImprovements.stories';

afterEach(cleanup);

it('renders the real landing screen with synthetic organisation and account data', async () => {
  render(<Landing />);
  expect(await screen.findByText('Import. Review. Protect.')).toBeTruthy();
  expect(await screen.findByText('Acme Research')).toBeTruthy();
  expect(await screen.findByText('Alex Rivera')).toBeTruthy();
});

it('renders the real account menu open', async () => {
  render(<AccountMenuOpen />);
  expect(await screen.findByRole('menu', { name: 'Account' })).toBeTruthy();
});

it('renders the real organisation menu open', async () => {
  render(<OrganizationMenuOpen />);
  expect(await screen.findByRole('menu', { name: 'Organisations' })).toBeTruthy();
});
