import { custodianShareCopy } from '@safetech/inheriti-elements-core/browser';
type Semantic = 'username' | 'email' | 'password';
interface FieldMetadata { targetId: string; origin: string; navigationId: string; semantic: Semantic; label: string }
interface ProtectedField { assetName: string; fieldName: Semantic; matchesOrigin: boolean; planId: string; selector: string }
interface Mapping { protectedField: ProtectedField; pageTarget: FieldMetadata }
interface Candidate { planName: string; assetFieldNames: readonly Semantic[];
  suggestion: { confidence: string; reason: string; mapping: Mapping } }
interface RevealState { kind: 'IDLE' | 'READY' | 'RUNNING' | 'DONE' | 'ERROR' | 'WARNING' | 'RESUMABLE'; planId?: string; message?: string; detail?: string; code?: 'reveal_restart_required' | 'reveal_access_changed' | 'active_access_open'; revealId?: string; expiresAt?: string; gateExpiresAt?: string }
interface FieldResult { selector: string; targetId: string; code: string }
interface Batch { identity: { planId: string }; mappings: readonly Mapping[] }

const STYLES = `
@font-face{font-family:AppFont;src:url(${chrome.runtime.getURL('side-panel/font-app.ttf')}) format('truetype');font-display:swap}
:host{all:initial}
@keyframes inheritiGlow{0%,100%{box-shadow:0 2px 8px #10182833,0 0 0 0 #2962ff55}50%{box-shadow:0 2px 8px #10182833,0 0 0 4px #2962ff22,0 0 15px #2962ff66}}
@keyframes inheritiShimmer{0%{background-position:-160px 0}100%{background-position:160px 0}}
.button{position:absolute;right:0;top:-12px;display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:#2962ff;color:#fff;cursor:pointer;box-shadow:0 2px 8px #10182833;animation:inheritiGlow 2.4s ease-in-out infinite}
.button:hover{box-shadow:0 2px 8px #10182833,0 0 16px #2962ff99}
.button svg{width:14px;height:17px;fill:currentColor}
.button:focus-visible{outline:3px solid #75a9ff}
@media(prefers-reduced-motion:reduce){.button{animation:none}}
.popover{position:fixed;inset:auto;margin:0;opacity:0;transform:translateY(-4px);transition:opacity .13s ease-out,transform .13s ease-out;display:flex;flex-direction:column;gap:7px;width:292px;max-width:min(292px,calc(100vw - 24px));padding:10px;border:1px solid #d0d5dd;border-radius:12px;background:#fff;color:#101828;font:12px/1.4 AppFont,system-ui;box-shadow:0 12px 32px #10182833;overflow:hidden}
.popover.shown{opacity:1;transform:none}
.popover.device-choice{box-sizing:border-box;width:360px;max-width:calc(100vw - 24px);gap:0;padding:18px;border-color:#d0d5dd;border-radius:16px;box-shadow:0 20px 48px #1018283d}
.device-logo{display:block;width:142px;max-width:100%;height:auto;margin:0 0 16px}
.device-eyebrow{margin:0 0 4px;color:#2962ff;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.device-title{margin:0;color:#101828;font-size:20px;font-weight:800;line-height:1.2;letter-spacing:-.03em}
.device-intro{margin:8px 0 16px;color:#667085;font-size:14px;line-height:1.5}
.device-options{display:grid;gap:10px}
.device-option{display:flex;align-items:center;gap:12px;width:100%;padding:12px;border:1px solid #d0d5dd;border-radius:9px;background:#fff;color:#101828;text-align:left;font:inherit;cursor:pointer}
.device-option:hover{border-color:#2962ff;background:#f0f6ff}
.device-option:focus-visible,.device-cancel:focus-visible{outline:3px solid #75a9ff;outline-offset:2px}
.device-option img{width:50px;height:50px;flex:none;object-fit:contain}
.device-option strong,.device-option small{display:block}
.device-option strong{font-size:14px}
.device-option small{margin-top:3px;color:#667085;font-size:12px;line-height:1.4}
.device-cancel{align-self:flex-start;margin:14px 0 0;padding:6px 0;border:0;background:transparent;color:#475467;font:inherit;font-weight:700;cursor:pointer}
@media(prefers-reduced-motion:reduce){.popover{transition:none}}
.title{flex:none;margin:0;font-weight:800;letter-spacing:.01em}
.filter{flex:none;box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#101828;font:inherit}
.filter:focus-visible{outline:2px solid #2962ff;border-color:#2962ff}
.list{display:flex;flex:1 1 auto;flex-direction:column;gap:4px;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}
.item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:1px solid #eaecf0;border-radius:8px;background:#f9fafb;color:#101828;text-align:left;font:inherit;cursor:pointer}
.item:hover{border-color:#b6c6dd;background:#f4f7fb}
.item.selected{border-color:#2962ff;background:#eef4ff}
.item.pending{opacity:.72}
.item-body{display:flex;min-width:0;flex:1;flex-direction:column}
.item-body strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item-body span{margin-top:2px;color:#667085;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tick{flex:none;width:12px;color:#2962ff;font-weight:800;text-align:center}
.item.skeleton{cursor:default;pointer-events:none}
.bone{display:block;height:9px;border-radius:5px;background:linear-gradient(90deg,#eaecf0 0,#f4f6f9 40%,#eaecf0 80%);background-size:160px 100%;animation:inheritiShimmer 1.1s linear infinite;width:52%}
.bone.wide{width:78%;height:11px;margin-bottom:5px}
.mapped{flex:none;display:flex;flex-direction:column;gap:3px}
.mapped:empty{display:none}
.mapped-title{margin:0;color:#98a2b3;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.mapped-row{display:flex;align-items:center;gap:6px;padding:4px 7px;border-radius:7px;background:#f4f7fb;font-size:10px;color:#475467}
.mapped-page{flex:none;max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:#101828}
.mapped-field{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.actions{flex:none;display:flex;flex-wrap:wrap;gap:6px}
.actions .primary{flex:1 1 100%}
.status{margin:0;color:#667085;font-size:10px}
.action{flex:none;padding:7px 10px;border-radius:8px;font:inherit;font-weight:700;cursor:pointer}
.action.primary{border:0;background:#2962ff;color:#fff;box-shadow:0 1px 2px #10182814}
.action.primary:hover{background:#0059e0}
.action.ghost{border:1px solid #eaecf0;background:#fff;color:#475467;font-weight:600}
.action.ghost:hover{border-color:#d0d5dd;background:#f9fafb}
.action:focus-visible{outline:2px solid #75a9ff;outline-offset:1px}
.tip{position:absolute;right:0;bottom:36px;width:max-content;max-width:220px;padding:5px 8px;border-radius:7px;background:#101828;color:#fff;font:11px/1.35 AppFont,system-ui;white-space:nowrap;opacity:0;transform:translateY(3px);transition:opacity .12s ease,transform .12s ease;pointer-events:none}
.button:hover+.tip,.button:focus-visible+.tip{opacity:1;transform:translateY(0)}
@media(prefers-reduced-motion:reduce){.tip{transition:none}}
.reveal-head{flex:none;display:flex;align-items:center;gap:7px;color:#2962ff;font-size:12px}
.reveal-head.success{color:#079455}
.reveal-head.failed{color:#d92d20}
.reveal-head.warning{color:#101828;font-size:20px;line-height:1.2}
.reveal-head.warning .glyph{display:grid;place-items:center;flex:none;width:24px;height:24px;border:1px solid #fae17d;border-radius:50%;background:#fff9e9;color:#dd9509;font-size:16px}
.popover.warning-state{box-sizing:border-box;width:360px;max-width:calc(100vw - 24px);border-color:#fff8c5;background:#fffcf3}
.warning-state .title{overflow-wrap:anywhere}
.warning-state .phase{font-size:14px}
.warning-state .countdown{color:#475467;font-size:12px;line-height:1.5}
.warning-state .action.primary{background:#934508}
.warning-state .action.primary:hover{background:#783708}
.reveal-head .spinner,.reveal-head .glyph{width:13px;text-align:center;font-weight:800}
.phase{flex:none;margin:0;color:#101828;font-size:13px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.dots{display:inline-block;width:14px;text-align:left}
.mapped.quiet .mapped-row{background:transparent;padding:2px 0;color:#98a2b3;font-size:9px}
.mapped.quiet .mapped-page{color:#667085;font-weight:600}
.countdown{flex:none;margin:0;color:#667085;font-size:11px}
.results{display:flex;flex:none;flex-direction:column;gap:3px;margin:0;padding:0;list-style:none}
.result{display:flex;justify-content:space-between;gap:8px;padding:5px 7px;border-radius:7px;background:#f9fafb;font-size:10px}
.result.filled strong{color:#079455}
.result.failed strong{color:#d92d20}
`;

const ROOT_ATTRIBUTE = 'data-inheriti-elements-overlay';
const INSTANCE_KEY = '__inheritiOverlayV1__';
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const controls = new Map<HTMLInputElement, HTMLElement>();
let observer: MutationObserver | undefined;
let openPopover: HTMLElement | undefined;
let openPopoverHost: HTMLElement | undefined;
let revealTimers: number[] = [];
let anchored: { anchor: HTMLElement; popover: HTMLElement } | undefined;
let activeRevealIdentity: Batch['identity'] | undefined;
let cancelCustodianChoice: (() => void) | undefined;
const CLAIM_ATTRIBUTE = 'data-inheriti-elements-overlay-claim';
const claim = crypto.randomUUID();
const overlayGlobal = globalThis as typeof globalThis & { [INSTANCE_KEY]?: { destroy(): void } };
overlayGlobal[INSTANCE_KEY]?.destroy();

/**
 * Each injection of this script gets its own isolated world, so a JavaScript global cannot tell one
 * instance from another. The claim lives on the shared document instead: the newest instance takes
 * it, sweeps away the controls an older instance left behind, and every other instance stands down
 * on its next scan. Without it a page collects one overlay per injection, stacked over each field.
 */
function boot(): void {
  cleanup();
  document.documentElement.setAttribute(CLAIM_ATTRIBUTE, claim);
  for (const host of Array.from(document.querySelectorAll(`[${ROOT_ATTRIBUTE}]`))) host.remove();
  scan();
  observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['type', 'autocomplete', 'disabled', 'readonly', 'hidden'] });
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('pointerdown', onOutsidePointerDown, true);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
}

function scan(): void {
  if (document.documentElement.getAttribute(CLAIM_ATTRIBUTE) !== claim) { cleanup(); return; }
  for (const [input, host] of controls) if (!input.isConnected || !compatible(input)) { host.remove(); controls.delete(input); }
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input'))) {
    if (controls.has(input) || !compatible(input)) continue;
    attach(input);
  }
  positionControls();
}

function attach(input: HTMLInputElement): void {
  const host = document.createElement('span');
  host.setAttribute(ROOT_ATTRIBUTE, '');
  host.style.cssText = 'all:initial;display:block;position:fixed;width:0;height:0;z-index:2147483646';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'button';
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark.setAttribute('viewBox', '0 0 26 32'); mark.setAttribute('aria-hidden', 'true');
  const markPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  markPath.setAttribute('d', 'M14.2718.2767a4.57 4.57 0 0 0-2.824.0098L2.9978 3.1661A4.427 4.427 0 0 0 0 7.3563v11.5719c0 4.7954 3.1977 10.0393 11.133 12.9002 1.3501.4867 2.6822-.5547 2.6822-1.9167V19.2703l2.5761-3.2186h4.2535a.949.949 0 0 0 0-1.8981h-2.7343l2.6614-3.325a.95.95 0 0 0-.1158-1.3249.899.899 0 0 0-1.2646.1106l-1.598 1.9965V7.6256a.919.919 0 1 0-1.8381 0v6.2817l-1.9402 2.4241V5.4845a.876.876 0 1 0-1.7515 0v11.0708l-2.0598-2.5736V7.6256a.919.919 0 1 0-1.838 0v4.0597L6.5882 9.7142a.9.9 0 0 0-1.2647-.1106.95.95 0 0 0-.1157 1.3249l2.6288 3.2844H5.2901a.919.919 0 1 0 0 1.839h3.9058c.0365 0 .0724-.0021.1077-.0062l2.726 3.4059.0341.0403v10.4198c0 .2224-.1972.3185-.337.2681-7.3962-2.6665-9.9753-7.3477-9.9753-11.2516V7.3563c0-1.1446.7282-2.1623 1.8111-2.5314l8.4499-2.8797a2.68 2.68 0 0 1 1.7062-.0059l8.7004 2.8983a2.676 2.676 0 0 1 1.8285 2.5373v11.6109l.0007.166c-.0031.4667-.1879 5.4907-7.8423 9.756a.876.876 0 1 0 .8523 1.5309c8.2907-4.6199 8.7349-10.2808 8.7414-11.2756l-.0011-.1773V7.3749a4.426 4.426 0 0 0-3.0267-4.1999L14.2718.2767Z');
  mark.append(markPath); button.append(mark);
  button.setAttribute('aria-label', `Choose an Inheriti protected field for ${labelOf(input)}`);
  // Pointerdown, not click: the document-level dismissal runs in the capture phase and would
  // otherwise close a popover that the click after it had just opened.
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault(); event.stopPropagation();
    if (openPopoverHost === host) { closePopover(); return; }
    void openChooser(input, shadow, button);
  });
  button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); });
  const tip = element('span', 'tip', 'Inheriti · fill a protected field');
  tip.setAttribute('role', 'tooltip');
  shadow.append(style, button, tip); document.documentElement.append(host); controls.set(input, host);
  positionControl(input, host);
}

async function openChooser(input: HTMLInputElement, shadow: ShadowRoot, anchor: HTMLElement): Promise<void> {
  closePopover();
  openPopoverHost = shadow.host as HTMLElement; openPopoverHost.style.zIndex = '2147483647';
  const popover = document.createElement('section'); popover.className = 'popover'; popover.setAttribute('role', 'dialog');
  popover.popover = 'manual';
  popover.append(header('Autofill credentials'), skeleton());
  shadow.append(popover); openPopover = popover;
  popover.showPopover();
  place(anchor, popover);
  // Placed first, shown after: the popover never paints at the position it was measured from.
  requestAnimationFrame(() => { if (popover === openPopover) popover.classList.add('shown'); });
  const target = register(input);
  const response = await chrome.runtime.sendMessage({ type: 'overlay-load-candidates', target }).catch(() => undefined) as
    { ok?: boolean; candidates?: Candidate[]; batch?: Batch; pageTargets?: FieldMetadata[];
      emptyReason?: 'no-autofill-plans' | 'selected-plan-unavailable' | 'no-protected-fields' | 'no-matching-field' } | undefined;
  if (popover !== openPopover) return;
  const failure = (response as { error?: string } | undefined)?.error;
  if (response?.ok !== true) {
    const state = loadFailure(failure);
    popover.replaceChildren(header(state.title), status(state.message),
      action(state.action, state.primary ? 'primary' : 'ghost', state.close ? closePopover : openSidePanel));
    place(anchor, popover);
    return;
  }
  if (!response.candidates?.length) {
    const state = emptyState(response.emptyReason, target.semantic);
    popover.replaceChildren(header(state.title), status(state.message),
      action('Open side panel', 'ghost', openSidePanel));
    place(anchor, popover);
    return;
  }
  // The worker owns page-target identity: this instance's own ids mean nothing to the shared batch.
  renderChooser(popover, response.candidates, response.pageTargets?.[0] ?? target, response.batch);
  place(anchor, popover);
}

function openSidePanel(): void {
  void chrome.runtime.sendMessage({ type: 'overlay-open-side-panel' }).catch(() => undefined);
  closePopover();
}

/** Three shimmering rows shaped like the suggestions they stand in for. */
function skeleton(): HTMLElement {
  const list = element('div', 'list');
  for (let row = 0; row < 3; row += 1) {
    const item = element('div', 'item skeleton');
    item.append(element('span', 'bone wide'), element('span', 'bone'));
    list.append(item);
  }
  return list;
}

/**
 * The suggestion list for this field, filtered by plan or asset. What is already mapped on the page
 * stays visible: the choice for this field keeps its mark in the list, and the fields chosen on other
 * inputs are listed above it, so nothing the operator picked disappears when the popover moves.
 */
function renderChooser(popover: HTMLElement, candidates: readonly Candidate[], target: FieldMetadata, initial?: Batch): void {
  const mapped = element('div', 'mapped');
  const list = element('div', 'list');
  const actions = element('div', 'actions');
  let batch = initial;
  let query = '';

  const filter = document.createElement('input');
  filter.type = 'search'; filter.className = 'filter'; filter.placeholder = 'Filter credentials';
  filter.setAttribute('aria-label', 'Filter credentials');
  filter.addEventListener('input', ({ target: box }) => {
    // The overlay's own filter box, inside the closed shadow root. Page field values are never read.
    const { value } = box as HTMLInputElement;
    query = value;
    paintList();
  });
  filter.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePopover(); });

  const chosenHere = () => mappingsOf(batch)
    .find((mapping) => mapping.pageTarget.targetId === target.targetId)?.protectedField;

  const paintList = (pending?: Candidate): void => {
    const visible = matching(candidates, query);
    const selected = chosenHere();
    if (visible.length === 0) { list.replaceChildren(status('No plan or asset matches that filter.')); return; }
    list.replaceChildren(...visible.map((candidate) => option(candidate, {
      selected: candidate.suggestion.mapping.protectedField.planId === selected?.planId
        && candidate.suggestion.mapping.protectedField.selector === selected.selector,
      pending: sameCandidate(candidate, pending),
      onPick: () => { void choose(candidate); },
    })));
    list.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' });
  };

  const paintMapped = (): void => {
    const mappings = mappingsOf(batch);
    if (mappings.length === 0) { mapped.replaceChildren(); return; }
    mapped.replaceChildren(element('p', 'mapped-title', `${mappings.length} field${mappings.length === 1 ? '' : 's'} ready`),
      ...mappings.map((mapping) => {
        const row = element('div', 'mapped-row');
        row.append(element('span', 'tick', '✓'), element('span', 'mapped-page', mapping.pageTarget.label),
          element('span', 'mapped-field', `${mapping.protectedField.assetName} · ${mapping.protectedField.fieldName}`));
        return row;
      }));
  };

  const paintActions = (): void => {
    const count = mappingsOf(batch).length;
    if (count === 0) { actions.replaceChildren(action('Close', 'ghost', closePopover)); return; }
    actions.replaceChildren(
      action(count === 1 ? 'Reveal and autofill' : `Reveal and autofill ${count} fields`, 'primary',
        () => { void runReveal(batch!, candidates, popover); }),
      action('Clear selection', 'ghost', () => { void clearAll(); }),
      action('Close', 'ghost', closePopover),
    );
  };

  const repaint = (pending?: Candidate): void => { paintMapped(); paintList(pending); paintActions(); reposition(); };

  const choose = async (candidate: Candidate): Promise<void> => {
    repaint(candidate);
    const response = await chrome.runtime.sendMessage({ type: 'overlay-select-candidate',
      mapping: candidate.suggestion.mapping, planName: candidate.planName }).catch(() => undefined) as
      { ok?: boolean; batch?: Batch } | undefined;
    if (popover !== openPopover) return;
    if (!response?.ok || response.batch === undefined) {
      repaint();
      actions.prepend(status(selectionError((response as { error?: string } | undefined)?.error)));
      return;
    }
    batch = response.batch;
    repaint();
  };

  const clearAll = async (): Promise<void> => {
    await chrome.runtime.sendMessage({ type: 'overlay-discard-selection' }).catch(() => undefined);
    if (popover !== openPopover) return;
    batch = undefined;
    repaint();
  };

  repaint();
  popover.replaceChildren(header('Autofill credentials'), filter, mapped, list, actions);
}

function mappingsOf(batch?: Batch): readonly Mapping[] {
  return batch?.mappings ?? [];
}

function matching(candidates: readonly Candidate[], query: string): readonly Candidate[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return candidates;
  return candidates.filter((candidate) => {
    const field = candidate.suggestion.mapping.protectedField;
    return `${candidate.planName} ${field.assetName} ${field.fieldName}`.toLowerCase().includes(needle);
  });
}

function sameCandidate(candidate: Candidate, other?: Candidate): boolean {
  return other !== undefined && other.suggestion.mapping.protectedField.planId === candidate.suggestion.mapping.protectedField.planId
    && other.suggestion.mapping.protectedField.selector === candidate.suggestion.mapping.protectedField.selector
    && other.suggestion.mapping.pageTarget.targetId === candidate.suggestion.mapping.pageTarget.targetId;
}

function option(candidate: Candidate, state: { selected: boolean; pending: boolean; onPick: () => void }): HTMLButtonElement {
  const field = candidate.suggestion.mapping.protectedField;
  const button = element('button', `item${state.selected ? ' selected' : ''}${state.pending ? ' pending' : ''}`);
  button.type = 'button';
  button.setAttribute('aria-pressed', String(state.selected));
  const body = element('span', 'item-body');
  const contents = candidate.assetFieldNames.map(titleCase).join(' + ');
  body.append(element('strong', '', field.assetName),
    element('span', '', `${candidate.planName} · ${contents}${field.matchesOrigin ? ' · Exact origin' : ''}`));
  button.append(body, element('span', 'tick', state.selected ? '✓' : state.pending ? '…' : ''));
  button.addEventListener('click', state.onPick);
  return button;
}

function titleCase(value: string): string { return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`; }

/** The CLI's reveal card, in the page: one phase at a time, with the fields it is working on. */
async function runReveal(batch: Batch, candidates: readonly Candidate[], popover: HTMLElement): Promise<void> {
  activeRevealIdentity = batch.identity;
  const planName = candidates.find((candidate) => candidate.suggestion.mapping.protectedField.planId === batch.identity.planId)?.planName;
  const spinner = element('span', 'spinner', SPINNER[0]);
  const title = element('strong', '', 'Revealing your plan');
  const heading = element('div', 'reveal-head');
  heading.append(spinner, title);
  const phase = element('p', 'phase');
  const phaseText = element('span', '', 'Opening the plan.');
  const dots = element('span', 'dots', '');
  phase.append(phaseText, dots);
  const countdown = element('p', 'countdown');
  const mapped = element('div', 'mapped quiet');
  mapped.append(...batch.mappings.map((mapping) => {
    const row = element('div', 'mapped-row');
    row.append(element('span', 'mapped-page', mapping.pageTarget.label),
      element('span', 'mapped-field', `${mapping.protectedField.assetName} · ${mapping.protectedField.fieldName}`));
    return row;
  }));
  // A gate the reveal is waiting on can outlive the cancel it was asked for. The card says so rather
  // than spinning on: the request stands, and the side panel is where its end is reported.
  let abandoned = false;
  const cancel = action('Cancel reveal', 'ghost', () => {
    cancel.disabled = true;
    cancel.textContent = 'Canceling…';
    void chrome.runtime.sendMessage({ type: 'overlay-cancel-reveal' }).catch(() => undefined);
    revealTimers.push(window.setTimeout(() => {
      if (popover !== openPopover) return;
      abandoned = true;
      stopRevealTimers();
      heading.className = 'reveal-head failed';
      spinner.className = 'glyph';
      spinner.textContent = '✕';
      title.textContent = 'Still canceling';
      dots.textContent = '';
      phaseText.textContent = 'The reveal has not stopped yet. Follow it in the side panel.';
      countdown.textContent = '';
      popover.replaceChildren(header(planName ?? 'Protected plan'), heading, phase, action('Close', 'ghost', closePopover));
      reposition();
    }, 6000));
  });
  popover.replaceChildren(header(planName ?? 'Protected plan'), heading, phase, countdown, mapped, cancel);
  reposition();

  let tick = 0;
  revealTimers = [
    window.setInterval(() => {
      tick += 1;
      spinner.textContent = SPINNER[tick % SPINNER.length]!;
      dots.textContent = '.'.repeat(Math.floor(tick / 4) % 4);
    }, 90),
    window.setInterval(() => { void pollReveal(phaseText, countdown, popover); }, 400),
  ];
  const result = await chrome.runtime.sendMessage({ type: 'overlay-reveal-and-autofill', batch }).catch(() => undefined) as
    { ok?: boolean; results?: FieldResult[] } | undefined;
  activeRevealIdentity = undefined;
  cancelCustodianChoice?.();
  const finalState = await chrome.runtime.sendMessage({ type: 'overlay-reveal-state', planId: batch.identity.planId }).catch(() => undefined) as
    { ok?: boolean; reveal?: RevealState } | undefined;
  stopRevealTimers();
  if (popover !== openPopover || abandoned) return;

  const results = result?.results ?? [];
  const filled = results.filter((one) => one.code === 'filled').length;
  const succeeded = result?.ok === true && results.length > 0 && filled === results.length;
  const interrupted = finalState?.reveal?.kind === 'RESUMABLE' && finalState.reveal.planId === batch.identity.planId
    || finalState?.reveal?.kind === 'RUNNING';
  const warning = finalState?.reveal?.kind === 'WARNING' || interrupted;
  popover.classList.toggle('warning-state', warning);
  heading.className = `reveal-head ${succeeded ? 'success' : warning ? 'warning' : 'failed'}`;
  spinner.className = 'glyph';
  spinner.textContent = succeeded ? '✓' : warning ? '!' : '✕';
  const failure = finalState?.ok === true && finalState.reveal?.kind === 'ERROR' ? finalState.reveal.message : undefined;
  title.textContent = succeeded ? 'Reveal complete' : interrupted ? 'Access interrupted' : warning ? 'Access still open'
    : failure?.includes('Access was denied') ? 'Access denied' : 'Reveal did not finish';
  dots.textContent = '';
  phaseText.textContent = succeeded ? 'Every field was written to the page' : warning
    ? finalState?.reveal?.message ?? 'This plan has an open access request.'
    : failure ?? 'The reveal stopped before it finished';
  countdown.textContent = warning ? (finalState?.reveal?.kind === 'WARNING' ? finalState.reveal.detail ?? '' : 'No fields were filled.') : results.length === 0
    ? 'Autofill could not continue. Open the side panel for details.'
    : `${filled} of ${results.length} fields autofilled. The form was not submitted.`;
  const outcomes = element('ul', 'results');
  outcomes.append(...results.map((one) => {
    const item = element('li', one.code === 'filled' ? 'result filled' : 'result failed');
    item.append(element('span', '', labelFor(one, batch)), element('strong', '', resultLabel(one.code)));
    return item;
  }));
  const retry = () => {
    popover.classList.remove('warning-state');
    const shadow = popover.getRootNode() as ShadowRoot;
    const input = [...controls].find(([, host]) => host === shadow.host)?.[0];
    const anchor = shadow.querySelector<HTMLElement>('.button');
    if (input && anchor) void chrome.runtime.sendMessage({ type: 'overlay-discard-selection' })
      .catch(() => undefined).then(() => { if (popover === openPopover) void openChooser(input, shadow, anchor); });
    else closePopover();
  };
  const observedRevealId = finalState?.reveal?.kind === 'WARNING' ? finalState.reveal.revealId : undefined;
  const finish = typeof observedRevealId === 'string'
    ? action('Cancel active access', 'primary', () => {
      finish.disabled = true;
      phaseText.textContent = 'Canceling the active access…';
      void chrome.runtime.sendMessage({ type: 'overlay-abort-plan-access', planId: batch.identity.planId })
        .then((response: { ok?: boolean; reveal?: RevealState; error?: string }) => {
          if (popover !== openPopover) return;
          if (response?.ok && response.reveal?.kind === 'DONE') {
            closePopover();
          }
          else { phaseText.textContent = 'Could not cancel this access. Try again or open InheritiGuard.'; finish.disabled = false; }
        })
        .catch(() => { phaseText.textContent = 'Could not cancel this access. Try again or open InheritiGuard.'; finish.disabled = false; });
    })
    : interrupted ? action('Cancel pending request', 'primary', () => {
      finish.disabled = true;
      phaseText.textContent = 'Checking the pending request…';
      void chrome.runtime.sendMessage({ type: 'overlay-cancel-pending-access', planId: batch.identity.planId })
        .then((response: { ok?: boolean; reveal?: RevealState }) => {
          if (popover !== openPopover) return;
          if (response?.ok && response.reveal?.kind === 'DONE') {
            closePopover();
          } else if (response?.ok && response.reveal?.kind === 'WARNING') {
            phaseText.textContent = 'An access request opened while checking. Try again to review and cancel it.';
            finish.replaceWith(action('Review access', 'primary', retry));
          } else { phaseText.textContent = 'Could not check this request. Try again.'; finish.disabled = false; }
          reposition();
        })
        .catch(() => { phaseText.textContent = 'Could not check this request. Try again.'; finish.disabled = false; });
    })
    : action(succeeded ? 'Done' : 'Try again', succeeded ? 'ghost' : 'primary', succeeded ? closePopover : retry);
  popover.replaceChildren(header(planName ?? 'Protected plan'), heading, phase, countdown, outcomes, finish,
    ...(warning ? [action(interrupted ? 'Close' : 'Leave access open', 'ghost', closePopover)] : []));
  reposition();
}

/** One phase at a time: the newest message replaces the last, it is never a growing list. */
async function pollReveal(phaseText: HTMLElement, countdown: HTMLElement, popover: HTMLElement): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'overlay-reveal-state' }).catch(() => undefined) as
    { ok?: boolean; reveal?: RevealState } | undefined;
  if (popover !== openPopover || response?.ok !== true || response.reveal?.kind !== 'RUNNING') return;
  if (response.reveal.message !== undefined) phaseText.textContent = response.reveal.message.replace(/[.…]+$/u, '');
  const deadline = response.reveal.gateExpiresAt ?? response.reveal.expiresAt;
  countdown.textContent = deadline === undefined ? '' : `Time remaining  ${remaining(deadline)}`;
}

function remaining(deadline: string): string {
  const seconds = Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;
}

function labelFor(result: FieldResult, batch: Batch): string {
  const field = batch.mappings.find((mapping) => mapping.protectedField.selector === result.selector)?.protectedField;
  return field === undefined ? result.selector : `${field.assetName} · ${field.fieldName}`;
}

function loadFailure(code?: string): { title: string; message: string; action: string; primary?: boolean; close?: boolean } {
  if (code === 'signed-out') return { title: 'Sign in to use autofill',
    message: 'Open InheritiGuard and sign in, then try this field again.', action: 'Open InheritiGuard', primary: true };
  if (code === 'stale-page-context') return { title: 'This field changed',
    message: 'The page changed after InheritiGuard found this input. Close this message and try the field again.', action: 'Close', close: true };
  if (code === 'access-request-failed') return { title: 'Plans could not be loaded',
    message: 'Open the side panel to check your account and try again.', action: 'Open side panel' };
  if (code === undefined) return { title: 'InheritiGuard did not respond',
    message: 'Reload this page, then try the field again.', action: 'Close', close: true };
  return { title: 'Autofill is unavailable',
    message: 'Open the side panel for details and try again.', action: 'Open side panel' };
}

function emptyState(
  reason: 'no-autofill-plans' | 'selected-plan-unavailable' | 'no-protected-fields' | 'no-matching-field' | undefined,
  semantic: Semantic,
): { title: string; message: string } {
  if (reason === 'no-autofill-plans') return { title: 'No plans support autofill',
    message: 'No plan contains a username, email, or password asset.' };
  if (reason === 'selected-plan-unavailable') return { title: 'Selected plan unavailable',
    message: 'The plan already chosen for this page is no longer available. Clear the selection in the side panel and try again.' };
  if (reason === 'no-protected-fields') return { title: 'No autofill fields found',
    message: 'Your plans do not contain username, email, or password fields.' };
  return { title: `No matching ${semantic} field`,
    message: `Your plans have autofill fields, but none match this ${semantic} input.` };
}

function selectionError(code?: string): string {
  if (code === 'stale-page-context') return 'The page changed. Close this and open the field again.';
  if (code === 'invalid-access-batch') return 'That field is no longer available. Choose it again.';
  return 'That field could not be added. Open the side panel to continue.';
}

function resultLabel(code: string): string {
  if (code === 'filled') return 'Filled';
  if (code === 'canceled') return 'Canceled';
  if (code === 'stale-page-context') return 'Page changed';
  if (code === 'authorization-denied') return 'Not allowed on this site';
  if (code === 'field-unavailable') return 'Unavailable';
  return 'Not filled';
}

/**
 * Anchors the popover to the button that opened it, in viewport coordinates. It is fixed, so no
 * clipping or scrolling ancestor on the host page can cut it off, and it flips above the field when
 * the space below is short.
 */
function place(anchor: HTMLElement, popover: HTMLElement): void {
  anchored = { anchor, popover };
  const margin = 12;
  const gap = 6;
  const rect = anchor.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - margin;
  const above = rect.top - margin;
  const flip = below < 240 && above > below;
  popover.style.maxHeight = `${Math.round(Math.max(180, Math.min(420, (flip ? above : below) - gap)))}px`;
  const width = popover.offsetWidth;
  const left = Math.min(Math.max(margin, rect.right + gap - width), window.innerWidth - width - margin);
  popover.style.left = `${Math.round(Math.max(margin, left))}px`;
  popover.style.top = `${Math.round(flip ? Math.max(margin, rect.top - gap - popover.offsetHeight) : rect.bottom + gap)}px`;
}

function reposition(): void {
  positionControls();
  if (anchored !== undefined) place(anchored.anchor, anchored.popover);
}

function positionControls(): void {
  for (const [input, host] of controls) positionControl(input, host);
}

function positionControl(input: HTMLInputElement, host: HTMLElement): void {
  const rect = input.getBoundingClientRect();
  host.style.left = `${Math.round(rect.right - 6)}px`;
  host.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
}

function register(input: HTMLInputElement): FieldMetadata {
  type Registry = { navigationId: string; href: string; targets: Map<string, HTMLInputElement> };
  const page = globalThis as typeof globalThis & { __inheritiPageTargetsV1__?: Registry };
  let registry = page.__inheritiPageTargetsV1__;
  if (registry === undefined || registry.href !== location.href) registry = page.__inheritiPageTargetsV1__ = {
    navigationId: crypto.randomUUID(), href: location.href, targets: new Map(),
  };
  let targetId = [...registry.targets].find(([, value]) => value === input)?.[0];
  if (targetId === undefined) { targetId = crypto.randomUUID(); registry.targets.set(targetId, input); }
  return { targetId, origin: location.origin, navigationId: registry.navigationId, semantic: semanticOf(input)!, label: labelOf(input) };
}

function semanticOf(input: HTMLInputElement): Semantic | undefined {
  const autocomplete = input.autocomplete.toLowerCase().split(/\s+/).at(-1);
  if (autocomplete === 'username') return 'username'; if (autocomplete === 'email') return 'email';
  if (autocomplete === 'current-password' || autocomplete === 'new-password' || input.type === 'password') return 'password';
  if (input.type === 'email') return 'email'; if (input.type !== 'text') return undefined;
  const hint = `${input.getAttribute('aria-label') ?? ''} ${input.name} ${input.id} ${input.placeholder}`.toLowerCase();
  return /e-?mail/.test(hint) ? 'email' : /user|login|account/.test(hint) ? 'username' : undefined;
}
function compatible(input: HTMLInputElement): boolean {
  if (semanticOf(input) === undefined || input.disabled || input.readOnly || input.hidden) return false;
  const style = getComputedStyle(input); const rect = input.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
    && rect.width > 0 && rect.height > 0;
}
function labelOf(input: HTMLInputElement): string { return input.getAttribute('aria-label')?.trim() || input.placeholder || input.name || input.id || `${semanticOf(input) ?? 'login'} field`; }

function element<TTag extends keyof HTMLElementTagNameMap>(tag: TTag, className: string, text?: string): HTMLElementTagNameMap[TTag] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function header(text: string): HTMLParagraphElement { return element('p', 'title', text); }
function status(text: string): HTMLParagraphElement { return element('p', 'status', text); }
function action(text: string, kind: 'primary' | 'ghost', onClick: () => void): HTMLButtonElement {
  const button = element('button', `action ${kind}`, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  closePopover();
}
function onOutsidePointerDown(event: PointerEvent): void {
  if (openPopoverHost === undefined) return;
  const path = event.composedPath();
  if (path.includes(openPopoverHost)) return;
  // Any overlay host, including one belonging to another injected instance, is ours and never dismisses.
  if (path.some((node) => node instanceof Element && node.hasAttribute(ROOT_ATTRIBUTE))) return;
  closePopover();
}
function stopRevealTimers(): void {
  for (const timer of revealTimers) window.clearInterval(timer);
  revealTimers = [];
}
function closePopover(): void {
  activeRevealIdentity = undefined;
  cancelCustodianChoice?.();
  stopRevealTimers();
  anchored = undefined;
  if (openPopover?.matches(':popover-open')) openPopover.hidePopover();
  openPopover?.remove(); openPopover = undefined;
  if (openPopoverHost !== undefined) openPopoverHost.style.zIndex = '2147483646';
  openPopoverHost = undefined;
}
function cleanup(): void {
  observer?.disconnect(); observer = undefined; document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('pointerdown', onOutsidePointerDown, true);
  window.removeEventListener('scroll', reposition, true);
  window.removeEventListener('resize', reposition);
  chrome.runtime.onMessage.removeListener(onOverlayMessage);
  closePopover();
  for (const host of controls.values()) host.remove(); controls.clear();
}

function onOverlayMessage(message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): boolean {
  if (document.documentElement.getAttribute(CLAIM_ATTRIBUTE) !== claim) return false;
  const type = (message as { type?: unknown })?.type;
  if (type === 'inheriti-overlay-teardown') cleanup();
  if (type === 'inheriti-overlay-choose-custodian') {
    const identity = (message as { identity?: unknown }).identity;
    if (openPopover === undefined || activeRevealIdentity === undefined
      || JSON.stringify(identity) !== JSON.stringify(activeRevealIdentity)) { sendResponse(undefined); return false; }
    const popover = openPopover;
    const previous = Array.from(popover.children);
    let answered = false;
    const answer = (choice?: 'SK_MOBILE' | 'SK_PRO') => {
      if (answered) return;
      answered = true;
      cancelCustodianChoice = undefined;
      if (popover === openPopover) { popover.classList.remove('device-choice'); popover.replaceChildren(...previous); reposition(); }
      sendResponse(choice);
    };
    cancelCustodianChoice = () => answer();
    const logo = document.createElement('img');
    logo.className = 'device-logo'; logo.alt = 'Inheriti® Business';
    logo.src = chrome.runtime.getURL('side-panel/assets/inheriti-business-logo.png');
    const options = element('div', 'device-options');
    for (const [choice, title, detail, image] of [
      ['SK_PRO', custodianShareCopy.choice.proOption, custodianShareCopy.choice.proDescription, 'safekey-pro.png'],
      ['SK_MOBILE', custodianShareCopy.choice.mobileOption, custodianShareCopy.choice.mobileDescription, 'safekey-mobile.png'],
    ] as const) {
      const button = element('button', 'device-option'); button.type = 'button';
      const picture = document.createElement('img'); picture.alt = '';
      picture.src = chrome.runtime.getURL(`side-panel/assets/${image}`);
      const copy = element('span', '');
      copy.append(element('strong', '', title), element('small', '', detail));
      button.append(picture, copy); button.addEventListener('click', () => answer(choice));
      options.append(button);
    }
    const cancel = element('button', 'device-cancel', 'Cancel reveal');
    cancel.type = 'button'; cancel.addEventListener('click', () => answer());
    popover.classList.add('device-choice');
    popover.replaceChildren(logo, element('p', 'device-eyebrow', 'InheritiGuard · Plan access'),
      element('h2', 'device-title', custodianShareCopy.choice.title),
      element('p', 'device-intro', custodianShareCopy.choice.intro), options, cancel);
    reposition();
    return true;
  }
  if (type === 'inheriti-overlay-discover-targets') {
    sendResponse([...controls.keys()].filter(compatible).map(register));
  }
  return false;
}
window.addEventListener('pagehide', cleanup, { once: true });
overlayGlobal[INSTANCE_KEY] = { destroy: cleanup };
boot();
chrome.runtime.onMessage.addListener(onOverlayMessage);
