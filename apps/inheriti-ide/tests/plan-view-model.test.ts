import { describe, expect, it } from 'vitest';
import { messageFor, rowsFor } from '../src/plan-view-model.js';

describe('plan view model', () => {
  it('renders signed out, loading, empty and error as four distinct rows', () => {
    const labels = (['SIGNED_OUT', 'LOADING', 'EMPTY'] as const)
      .map((kind) => rowsFor({ kind })[0]?.label)
      .concat(rowsFor({ kind: 'ERROR', code: 'elements_api_unavailable' })[0]?.label);
    expect(new Set(labels).size).toBe(4);
    expect(labels).not.toContain(undefined);
  });

  it('never lets a placeholder row be opened as a plan', () => {
    for (const state of [{ kind: 'SIGNED_OUT' }, { kind: 'LOADING' }, { kind: 'EMPTY' }] as const) {
      const [row] = rowsFor(state);
      expect(row?.contextValue).toBe('message');
      expect(row?.planId).toBeUndefined();
    }
  });

  it('renders one row per real plan, carrying its id', () => {
    const plans = [{ id: 'plan-1', name: 'Family vault', status: 'ACTIVE' }] as never;
    const [row] = rowsFor({ kind: 'PLANS', plans });
    expect(row).toMatchObject({ label: 'Family vault', description: 'ACTIVE', planId: 'plan-1', contextValue: 'plan' });
  });

  it('shows the Business context without making it an openable plan', () => {
    expect(rowsFor({ kind: 'SELECT_ORGANIZATION', count: 2 })[0]).toMatchObject({ contextValue: 'message' });
    const rows = rowsFor({ kind: 'PLANS', organization: 'Acme', plans: [{ id: 'plan-1', name: 'Vault', status: 'ACTIVE' }] as never });
    expect(rows[0]).toMatchObject({ label: 'Organization: Acme', contextValue: 'message' });
    expect(rows[1]).toMatchObject({ label: 'Vault', planId: 'plan-1' });
  });

  it('shows a status the SDK did not recognise as its raw value rather than blank', () => {
    const plans = [{ id: 'plan-1', name: 'Vault', status: { kind: 'UNKNOWN', raw: 'SUSPENDED' } }] as never;
    expect(rowsFor({ kind: 'PLANS', plans })[0]?.description).toBe('SUSPENDED');
  });

  it('maps a known error code to copy, and an unknown one to a safe default', () => {
    expect(messageFor('operator_reauthentication_required')).toMatch(/sign in again/iu);
    expect(messageFor('something_new_from_the_server')).toBe('Could not load plans');
  });
});
