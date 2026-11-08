// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPlanCreationVisual, planCreationVisualScript, planCreationVisualStyles } from '../src/plan-creation-visual/index.js';

describe('plan creation mosaic', () => {
  it('uses the four Business seal gates and four jigsaw tiles', () => {
    const html = renderPlanCreationVisual('generating_shares');
    expect(html.match(/<g class="mtile[^"]*" data-i=/g)).toHaveLength(4);
    for (const label of ['Org Key', 'Governance', 'Split & Encrypt', 'Storage']) expect(html).toContain(label);
    expect(html).toContain('mosaic-badge cipher');
    expect(html).toContain('xmlns:xlink');
  });
  it('shows only the validator tile scattered before distributing all tiles', () => {
    expect(renderPlanCreationVisual('distributing').match(/class="mtile colored out"/g)).toHaveLength(1);
    expect(renderPlanCreationVisual('configuring').match(/class="mtile colored out"/g)).toHaveLength(4);
  });
  it('does not claim storage completion while waiting or pending', () => {
    expect(renderPlanCreationVisual('awaiting-key')).toMatch(/data-key="orgKey"/);
    expect(renderPlanCreationVisual('verifying', 'PENDING')).toMatch(/class="mgate garc active" data-key="storage"/);
    expect(renderPlanCreationVisual('verifying', 'PENDING')).not.toContain('mosaic-cpulse run');
    expect(renderPlanCreationVisual('verifying', 'READY')).toMatch(/class="mgate garc done" data-key="storage"/);
    expect(renderPlanCreationVisual('verifying', 'READY')).toContain('mosaic-cpulse run');
    expect(renderPlanCreationVisual('distributing', 'FAILED')).toContain('mgate garc denied');
    expect(renderPlanCreationVisual('awaiting-key', 'FAILED')).toContain('mosaic-badge plain');
    expect(renderPlanCreationVisual('awaiting-key', 'FAILED')).not.toContain('mtile colored');
  });
  it('carries only observed phases, without protected values', () => {
    const html = renderPlanCreationVisual('verifying', undefined, ['securing', 'encrypting', 'verifying']);
    expect(html).toContain('data-visual-history=');
    expect(html).not.toContain('preflighting&quot;');
    expect(planCreationVisualScript).toContain('finishPlanCreationVisual');
    expect(() => new Function(planCreationVisualScript)).not.toThrow();
    expect(planCreationVisualStyles).toContain('prefers-reduced-motion');
  });
});


describe('plan creation visual queue', () => {
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); delete (window as any).updatePlanCreationVisual; delete (window as any).finishPlanCreationVisual; delete (window as any).resetPlanCreationVisual; });
  it('clamps backward phase jitter within one creation attempt', async () => {
    vi.useFakeTimers();
    new Function('window', 'document', 'MutationObserver', 'matchMedia', planCreationVisualScript)(window, document, MutationObserver, () => ({ matches: false }));
    document.body.innerHTML = `<main>${renderPlanCreationVisual('verifying', undefined, ['encrypting', 'configuring', 'encrypting', 'verifying'])}</main>`;
    (window as any).initializePlanCreationVisual(document.querySelector('main'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.querySelector('[data-plan-visual]')?.getAttribute('data-visual-phase')).toBe('configuring');
    await vi.advanceTimersByTimeAsync(750);
    expect(document.querySelector('[data-plan-visual]')?.getAttribute('data-visual-phase')).toBe('verifying');
    expect(document.querySelectorAll('.mtile.out')).toHaveLength(0);
    (window as any).resetPlanCreationVisual();
  });
  it('initializes a late first snapshot at the first observed phase before advancing', async () => {
    vi.useFakeTimers();
    new Function('window', 'document', 'MutationObserver', 'matchMedia', planCreationVisualScript)(window, document, MutationObserver, () => ({ matches: false }));
    document.body.innerHTML = `<main>${renderPlanCreationVisual('configuring', undefined, ['preparing-key', 'encrypting', 'configuring'])}</main>`;
    (window as any).initializePlanCreationVisual(document.querySelector('main'));
    expect(document.querySelector('[data-plan-visual]')?.getAttribute('data-visual-phase')).toBe('preparing-key');
    expect(document.querySelectorAll('.mtile.out')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(document.querySelector('[data-plan-visual]')?.getAttribute('data-visual-phase')).toBe('encrypting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.querySelector('[data-plan-visual]')?.getAttribute('data-visual-phase')).toBe('configuring');
    expect(document.querySelectorAll('.mtile.out')).toHaveLength(4);
    (window as any).resetPlanCreationVisual();
  });
  it('waits for READY after observed phases and stops when the visual is removed', async () => {
    vi.useFakeTimers();
    new Function('window', 'document', 'MutationObserver', 'matchMedia', planCreationVisualScript)(window, document, MutationObserver, () => ({ matches: false }));
    document.body.innerHTML = `<main>${renderPlanCreationVisual('securing')}</main>`;
    const next = document.createElement('main');
    next.innerHTML = renderPlanCreationVisual('verifying', 'READY', ['securing', 'encrypting', 'verifying']);
    let finished = false;
    const done = (window as any).finishPlanCreationVisual(document.querySelector('main'), next).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(600);
    expect(finished).toBe(false);
    expect(document.querySelector('.mgate[data-key="storage"]')?.classList.contains('done')).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(finished).toBe(true);
    expect(document.querySelector('.mgate[data-key="storage"]')?.classList.contains('done')).toBe(true);
    document.querySelector('main')?.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect((window as any).resetPlanCreationVisual).toBeTypeOf('function');
  });
  it('plays observed phases in order and flushes errors', async () => {
    vi.useFakeTimers();
    new Function('window', 'document', 'MutationObserver', 'matchMedia', planCreationVisualScript)(window, document, MutationObserver, () => ({ matches: false }));
    document.body.innerHTML = `<main><section class="result-card"><div>${renderPlanCreationVisual('securing')}</div><h1>Securing</h1><p>Start</p></section></main>`;
    const next = document.createElement('main');
    next.innerHTML = `<section class="result-card"><div>${renderPlanCreationVisual('distributing', undefined, ['securing', 'encrypting', 'distributing'])}</div><h1>Distributing</h1><p>Shares</p></section>`;
    expect((window as any).updatePlanCreationVisual(document.querySelector('main'), next)).toBe(true);
    expect(document.querySelector('.result-card h1')?.textContent).toBe('Distributing');
    await vi.advanceTimersByTimeAsync(600);
    expect(document.querySelector('[data-plan-visual]')?.getAttribute('data-visual-phase')).toBe('encrypting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.querySelector('[data-plan-visual]')?.getAttribute('data-visual-phase')).toBe('distributing');
    const error = document.createElement('main');
    error.innerHTML = renderPlanCreationVisual('distributing', 'FAILED', ['securing', 'encrypting', 'distributing']);
    expect((window as any).updatePlanCreationVisual(document.querySelector('main'), error)).toBe(true);
    expect(document.querySelector('.mgate.denied')).not.toBeNull();
    (window as any).resetPlanCreationVisual();
  });
});
