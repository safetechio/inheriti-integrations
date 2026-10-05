import type { LocalPlanClarification, LocalPlanDraft } from './local-plan-assistant.js';
import type { LocalPlanHints } from './local-plan-assistant.js';
import { localPlanSuggestionTimeoutMs } from './local-plan-assistant.js';
import { localPlanFieldMaxLength } from './local-plan-draft.js';
import { localPlanInputLimits } from './local-plan-source.js';
import { quickPlanAssetCatalog } from './quick-plan.js';
import { assetName, fieldLabels, fieldName, assetIconCodePoints, localPlanAssetLimit } from './asset-metadata.js';

export type LocalPlanPageOptions = {
  path: string;
  csrf: string;
  scriptNonce: string;
  draft: LocalPlanDraft | null;
  reviewAsset?: { type: string; title: string; name: string; fields: readonly string[] } | null;
  clarification: LocalPlanClarification | null;
  busy: boolean;
  selectedTeamId: string;
  selectedAssetType?: string | null;
  fieldValues: Readonly<Record<string, string>>;
  fieldValuesByAsset?: readonly Readonly<Record<string, string>>[];
  hasPreviousInput?: boolean;
  editableInput?: string;
  originalInputs?: readonly string[];
  context?: string;
  teams?: readonly { id: string; name: string }[];
  candidateAssetTypes?: readonly string[];
  fontUrl?: string;
  iconFontUrl?: string;
  messageValue?: string;
  hints?: LocalPlanHints;
};

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);

const icons = { eye: 61550, pen: 62212, plus: 61525, key: 61572, lock: 61475, chevron: 61560, sparkles: 58058, file: 61788, xmark: 61453, info: 61530 } as const;
const icon = (name: keyof typeof icons) => `<span class="fa-icon" aria-hidden="true">&#${icons[name]};</span>`;
const assetIconCodePoint = (type: string) => assetIconCodePoints[quickPlanAssetCatalog.find(({ id }) => id === type)?.iconName ?? ''] ?? icons.file;
const assetIcon = (type: string) => `<span class="fa-icon" aria-hidden="true">&#${assetIconCodePoint(type)};</span>`;
function reviewField(field: string, type: string, inputName: string, value?: string): string {
  const present = value !== undefined;
  const id = `field-${inputName.replace(/[^a-z0-9]/giu, '-')}`;
  const input = `<textarea id="${id}" name="${escape(inputName)}" rows="${type === 'PLAIN-TEXT' ? 5 : 2}" autocomplete="off" ${localPlanFieldMaxLength(field, type) ? `maxlength="${localPlanFieldMaxLength(field, type)}"` : ''}></textarea>`;
  return `<div class="asset-field">${present ? `<strong>${escape(fieldName(field))}</strong><div class="asset-field-actions"><button class="field-link" type="button" data-toggle-field="view" aria-controls="view-${id}" aria-expanded="false">${icon('eye')} Show value</button><button class="field-link" type="button" data-toggle-field="edit" aria-controls="edit-${id}" aria-expanded="false">${icon('pen')} Replace value</button></div><code id="view-${id}" class="field-panel" data-field-panel="view" hidden>${escape(value)}</code><div id="edit-${id}" class="field-panel" data-field-panel="edit" hidden><label for="${id}">New value</label>${input}</div>` : `<label for="${id}">${escape(fieldName(field))}</label>${input}`}</div>`;
}

function assetMagic(_index: number, type: string): string {
  return `<input type="hidden" data-asset-type value="${escape(type)}"><button class="asset-action" type="button" data-open-asset-magic aria-label="Suggest fields for asset" title="Suggest fields">${icon('sparkles')}</button>`;
}

function assetMagicDialog(): string {
  return `<dialog class="change-dialog asset-dialog" data-asset-dialog aria-labelledby="asset-dialog-heading"><div class="dialog-heading"><h2 id="asset-dialog-heading">Suggest fields</h2><button class="dialog-close" type="button" data-close-asset-magic aria-label="Close" title="Close">${icon('xmark')}</button></div><p class="helper">Paste values for the selected asset. Review the filled fields before creating the plan.</p><div class="field"><label for="asset-dialog-prompt">Asset values</label><textarea id="asset-dialog-prompt" data-asset-prompt rows="4" maxlength="${localPlanInputLimits.message}" autocomplete="off"></textarea></div><p class="helper" data-asset-suggestion-status role="status"></p><div class="dialog-actions"><button type="button" data-suggest-asset>${icon('sparkles')} Suggest fields</button></div></dialog>`;
}

function protectedDataHeading(): string {
  const help = 'All fields in this section are encrypted. Only authorised plan members can access this data.';
  return `<div class="protected-heading"><h4>Protected data</h4><span class="protected-info" role="img" tabindex="0" aria-label="${help}" title="${help}">${icon('info')}</span></div>`;
}

function blankAssetCard(index: number): string {
  return `<details class="asset-card" data-asset-index="${index}" data-added-asset><summary class="asset-card-header"><span class="asset-card-icon">${assetIcon('PLAIN-TEXT')}</span><span class="asset-card-title"><strong>New asset</strong><small>${escape(assetName('PLAIN-TEXT'))}</small></span><span class="asset-card-actions">${assetMagic(index, 'PLAIN-TEXT')}<button class="asset-action" type="button" data-remove-asset aria-label="Remove asset" title="Remove asset">${icon('xmark')}</button></span><span class="asset-chevron">${icon('chevron')}</span></summary><div class="asset-card-body"><div class="field"><label for="name-${index}">Asset name</label><input id="name-${index}" name="name:${index}" maxlength="200" required></div><div class="field"><label for="type-${index}">Asset type</label><select id="type-${index}" name="type:${index}" data-manual-type>${quickPlanAssetCatalog.map(({ id }) => `<option value="${escape(id)}" ${id === 'PLAIN-TEXT' ? 'selected' : ''}>${escape(assetName(id))}</option>`).join('')}</select></div><div class="protected-section">${protectedDataHeading()}<div class="protected-fields" data-manual-fields></div></div></div></details>`;
}

const style = `
  :root {
    color-scheme: light;
    font: 14px/1.6 AppFont, system-ui, sans-serif;
    color: #101828;
    background: #f9fafb;
    --primary: #2962ff;
    --primary-dark: #1642ba;
    --gray-border: #d0d5dd;
    --gray5: #f9fafb;
    --gray10: #eaecf0;
    --success: #15aa4c;
    --success10: #e8fff0;
    --danger: #dc3545;
    --danger10: #fff0f1;
    --gray-text: #475467;
    --space-s: 8px;
    --space-m: 16px;
    --space-l: 24px;
    --radius-s: 8px;
    --radius-m: 16px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: var(--space-l); }
  main { max-width: 840px; margin: auto; display: grid; gap: var(--space-m); }
  h1, h2, p, ul { margin: 0; }
  h1 { font-size: 24px; line-height: 1.3; }
  h2 { font-size: 18px; line-height: 1.4; }
  .page-header { display: grid; gap: var(--space-s); padding: var(--space-s) 0; }
  .eyebrow { color: var(--primary); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .subtitle, .helper, .context { color: var(--gray-text); }
  .context { overflow-wrap: anywhere; }
  .secure-notice { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid #dbe4ff; border-radius: var(--radius-s); background: #edf2ff; }
  .secure-notice strong { color: var(--primary-dark); }
  .steps { display: flex; align-items: center; gap: var(--space-m); min-height: 78px; margin: 0; padding: var(--space-m) var(--space-l); list-style: none; border: 1px solid #e4e7ec; border-radius: var(--radius-s); background: #fff; }
  .steps li { display: flex; align-items: center; gap: var(--space-s); white-space: nowrap; color: #667085; font-size: 12px; font-weight: 700; }
  .steps .current { color: var(--primary); }
  .step-number { display: inline-grid; place-items: center; width: 30px; height: 30px; flex: 0 0 30px; border: 1px solid #98a2b3; border-radius: 50%; color: #667085; }
  .steps .current .step-number, .steps .complete .step-number { border-color: var(--primary); color: #fff; background: var(--primary); }
  .steps .complete { color: var(--primary); }
  .panel { display: grid; gap: var(--space-m); padding: var(--space-l); border: 1px solid #eaecf0; border-radius: var(--radius-m); background: #fff; }
  .fa-icon { display: inline-block; width: 1.2em; font-family: FontAwesome6, sans-serif; font-style: normal; font-weight: 900; text-align: center; }
  html.native-linux-fonts { font-weight: 300; font-synthesis: none; }
  html.native-linux-fonts :is(input, select, textarea) { font-weight: 300; }
  html.native-linux-fonts :is(button, h1, h2, h3, h4, strong, b, label, legend, .eyebrow, .steps li) { font-weight: 600; }
  .compose-actions { display: grid; gap: 4px; justify-items: stretch; }
  .compose-actions .manual-link { justify-self: center; color: var(--primary); }
  .compose-actions .manual-link:hover:not(:disabled) { color: var(--primary-dark); }
  .section-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-m); padding-bottom: var(--space-s); border-bottom: 1px solid #eaecf0; }
  .section-heading h3 { margin: 0; font-size: 16px; }
  .section-heading .section-add { min-height: 36px; padding: 5px 10px; white-space: nowrap; }
  .section-heading .helper { margin-left: auto; }
  .asset-list { display: grid; gap: var(--space-s); }
  .asset-card { min-width: 0; margin: 0; border: 1px solid #bfeed0; border-radius: var(--radius-s); background: #f5fff9; }
  .asset-card[open] { border-color: #90e2af; }
  .asset-card-header { display: flex; align-items: center; gap: 12px; min-height: 68px; padding: 10px 12px; color: inherit; }
  summary.asset-card-header { cursor: pointer; list-style: none; }
  summary.asset-card-header::-webkit-details-marker { display: none; }
  .asset-card-header .asset-chevron { color: var(--gray-text); transition: transform .15s ease; }
  .asset-card[open] .asset-chevron { transform: rotate(180deg); }
  .asset-card-icon { display: grid; place-items: center; flex: 0 0 40px; width: 40px; height: 40px; border-radius: 10px; color: var(--success); background: var(--success10); font-size: 18px; }
  .asset-card-title { display: grid; min-width: 0; line-height: 1.35; }
  .asset-card-title strong { overflow-wrap: anywhere; font-size: 15px; }
  .asset-card-title small { color: var(--gray-text); }
  .asset-card-actions { display: flex; gap: 4px; align-items: center; margin-left: auto; }
  .asset-action { display: inline-grid; place-items: center; flex: 0 0 40px; width: 40px; min-height: 40px; padding: 0; border: 0; border-radius: var(--radius-s); color: var(--success); background: transparent; }
  .asset-action:hover:not(:disabled) { color: var(--success); background: var(--success10); }
  .asset-action[data-remove-asset]:hover:not(:disabled) { color: var(--danger); background: var(--danger10); }
  .asset-action:disabled { opacity: .35; }
  .asset-card-body { display: grid; gap: var(--space-m); padding: var(--space-m); border-top: 1px solid #bfeed0; background: #fff; }
  .protected-section { display: grid; gap: var(--space-s); }
  .protected-heading { display: flex; align-items: center; gap: 4px; }
  .protected-heading h4 { margin: 0; font-size: 14px; }
  .protected-info { display: inline-grid; place-items: center; width: 24px; height: 24px; color: #667085; font-size: 12px; cursor: help; }
  .protected-info:focus-visible { border-radius: 50%; }
  .protected-fields { display: grid; gap: var(--space-s); padding: var(--space-m); border: 1px solid var(--gray-border); border-radius: var(--radius-s); background: var(--gray5); }
  [data-manual-fields] { display: grid; gap: var(--space-s); }
  .asset-dialog { display: none; }
  .asset-dialog[open] { display: grid; align-content: start; gap: var(--space-m); width: min(560px, calc(100% - 32px)); height: fit-content; max-height: calc(100dvh - 32px); overflow-y: auto; }
  .asset-dialog .dialog-actions { align-items: center; }
  [data-asset-suggestion-status]:empty { display: none; }
  .asset-dialog .dialog-actions button { min-height: 40px; }
  .add-field-details > summary { display: inline-flex; align-items: center; gap: 6px; list-style: none; }
  .add-field-details > summary::-webkit-details-marker { display: none; }
  .asset-field { display: grid; gap: 6px; padding: 12px; border: 1px solid var(--gray10); border-radius: var(--radius-s); background: #fff; }
  .asset-field strong { font-size: 13px; }
  .asset-field-actions { display: flex; flex-wrap: wrap; gap: var(--space-m); }
  .field-link { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 0; border: 0; color: var(--primary-dark); background: transparent; font-size: 12px; font-weight: 600; }
  .field-link:hover:not(:disabled) { color: var(--primary); background: transparent; text-decoration: underline; }
  .field-panel { margin-top: var(--space-s); }
  code.field-panel { display: block; padding: 8px; overflow-wrap: anywhere; white-space: pre-wrap; border-radius: 4px; background: var(--gray5); }
  .field-panel textarea { margin-top: 6px; }
  .asset-field label { font-size: 13px; }
  .asset-field textarea { margin-top: 2px; }
  .dialog-heading { display: flex; align-items: start; justify-content: space-between; gap: var(--space-m); }
  .dialog-close { display: inline-grid; place-items: center; flex: 0 0 36px; width: 36px; min-height: 36px; padding: 0; border: 0; color: var(--gray-text); background: transparent; }
  .dialog-close:hover:not(:disabled) { color: var(--danger); background: var(--danger10); }
  .asset-type-controls .icon-button { color: var(--success); border-color: var(--success); }
  .asset-type-controls .icon-button:hover:not(:disabled) { color: var(--success); background: var(--success10); }
  .asset-field-actions textarea { min-height: 72px; }
  .review-section { display: grid; gap: var(--space-m); }
  .panel-heading { display: grid; gap: 4px; }
  .panel form { display: grid; gap: var(--space-m); }
  .field { display: grid; gap: 6px; min-width: 0; }
  label, legend { font-weight: 700; }
  .helper { font-size: 12px; line-height: 1.5; }
  input, select, textarea, button { font: inherit; min-width: 0; }
  input, select, textarea {
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--gray-border);
    border-radius: var(--radius-s);
    color: #101828;
    background: #fff;
  }
  input:hover:not(:disabled), select:hover:not(:disabled), textarea:hover:not(:disabled) { border-color: #a3b3bf; }
  textarea { resize: vertical; }
  input[type=file] { border-style: dashed; padding: 12px; background: #f9fafb; }
  input[type=file]::file-selector-button { margin-right: var(--space-s); padding: 6px 10px; border: 1px solid var(--gray-border); border-radius: var(--radius-s); color: var(--primary); background: #fff; font: inherit; cursor: pointer; }
  input[type=radio] { width: 18px; height: 18px; margin: 2px 0 0; padding: 0; accent-color: var(--primary); }
  .confirmations { display: grid; gap: var(--space-s); margin: 0; padding: 0; border: 0; }
  .confirmations legend { margin-bottom: var(--space-s); }
  .confirmations label { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: start; gap: 10px; font-weight: 400; }
  .field-list { display: grid; gap: var(--space-s); padding: 0; list-style: none; }
  .field-list li { display: grid; gap: var(--space-s); padding: 12px; border: 1px solid #eaecf0; border-radius: var(--radius-s); }
  .field-actions { display: flex; flex-wrap: wrap; gap: var(--space-m); }
  .field-actions details { min-width: 0; }
  .field-actions summary { font-weight: 700; }
  .review-heading { display: flex; align-items: start; justify-content: space-between; gap: var(--space-m); }
  .review-heading .button-secondary { min-height: 36px; white-space: nowrap; }
  .review-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-m); }
  .review-actions .restart-form, .restart-form { display: block; }
  .asset-type-controls { display: flex; gap: var(--space-s); }
  .asset-type-controls select { flex: 1; }
  .change-dialog { width: min(560px, calc(100% - 32px)); max-height: calc(100% - 32px); margin: auto; padding: var(--space-l); border: 1px solid #eaecf0; border-radius: var(--radius-m); color: #101828; background: #fff; }
  .change-dialog::backdrop { background: rgb(16 24 40 / .55); }
  .change-dialog form { display: grid; gap: var(--space-m); }
  .change-dialog details label { display: block; margin-top: var(--space-s); }
  .dialog-actions { display: flex; justify-content: flex-end; gap: var(--space-s); }
  button {
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid var(--primary);
    border-radius: var(--radius-s);
    color: #fff;
    background: var(--primary);
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--primary-dark); }
  button:disabled { cursor: default; opacity: .55; }
  .button-secondary { color: var(--primary); background: #fff; }
  .button-secondary:hover:not(:disabled) { color: #fff; }
  .icon-button { position: relative; display: inline-grid; place-items: center; width: 44px; flex: 0 0 44px; padding: 0; }
  .icon-button svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  button[aria-busy=true] { opacity: .85; }
  button[aria-busy=true]::after { content: ''; display: inline-block; width: 16px; height: 16px; margin-left: 8px; vertical-align: -3px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
  .icon-button[aria-busy=true] svg { visibility: hidden; }
  .icon-button[aria-busy=true]::after { position: absolute; margin: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { button[aria-busy=true]::after { animation: none; } }
  [hidden] { display: none !important; }
  .cancel-form { display: flex; justify-content: flex-start; padding-top: var(--space-m); border-top: 1px solid #eaecf0; }
  .cancel-link, .manual-link { min-height: 32px; padding: 0; border: 0; color: var(--gray-text); background: none; text-decoration: underline; text-underline-offset: 3px; }
  .cancel-link:hover:not(:disabled), .manual-link:hover:not(:disabled) { color: #101828; background: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
  :focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .status { color: #a12b1d; }
  .status[role=status] { color: var(--gray-text); }
  .review-notes { display: grid; gap: var(--space-s); padding: var(--space-m); border: 1px solid #eaecf0; border-radius: var(--radius-s); background: #f9fafb; }
  .review-notes ul { padding-left: 20px; }
  .follow-up { display: grid; gap: 4px; padding: var(--space-m); border-left: 3px solid var(--primary); border-radius: 0 var(--radius-s) var(--radius-s) 0; background: #f9fbff; }
  .follow-up strong { font-size: 16px; }
  .original-input pre { max-height: 240px; overflow: auto; margin: var(--space-s) 0 0; padding: var(--space-m); border: 1px solid #eaecf0; border-radius: var(--radius-s); background: #f9fafb; white-space: pre-wrap; overflow-wrap: anywhere; }
  [role=alert] { color: #a12b1d; }
  details { min-width: 0; }
  summary { color: var(--primary-dark); cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::marker { content: ''; }
  .original-input > summary, .change-dialog details > summary { display: inline-flex; align-items: center; gap: 6px; }
  .original-input > summary .fa-icon, .change-dialog details > summary .fa-icon { font-size: 12px; }
  details code { display: block; margin-top: var(--space-s); padding: 8px; overflow-wrap: anywhere; white-space: pre-wrap; border-radius: 4px; background: #f9fafb; }
  @media (max-width: 600px) { body { padding: var(--space-m); } .panel, .change-dialog { padding: var(--space-m); } .steps { padding: var(--space-m); gap: var(--space-s); } .steps li { white-space: normal; } .review-heading { display: grid; } .asset-card-header { gap: var(--space-s); } .asset-card-icon { flex-basis: 34px; width: 34px; height: 34px; } }
`;

export function renderLocalPlanPage(options: LocalPlanPageOptions, message = '', error = false): string {
  const { path, csrf, draft, clarification, busy } = options;
  const reviewAsset = draft ? { type: draft.asset.type, title: draft.title, name: draft.asset.name, fields: Object.keys(draft.asset.fields) } : options.reviewAsset;
  const questions = clarification?.questions ?? draft?.questions ?? [];
  const unassigned = clarification?.unassignedSources ?? draft?.unassignedSources ?? [];
  const descriptionField = `<div class="field"><label for="description">Plan description <span class="helper">(optional)</span></label><textarea id="description" name="description" rows="2" maxlength="1000">${escape(options.hints?.description ?? '')}</textarea></div>`;
  const excluded = draft ? (options.candidateAssetTypes ?? []).filter((type) => !(draft.assets ?? [draft.asset]).some((asset) => asset.type === type)) : [];
  const assetDefinition = reviewAsset ? quickPlanAssetCatalog.find(({ id }) => id === reviewAsset.type) : undefined;
  const attention = reviewAsset && (questions.length || unassigned.length || excluded.length) ? `<section class="review-notes" aria-label="Details to review">
    <h2>Details to review</h2>
    ${questions.length ? `<ul>${questions.map((question) => `<li>${escape(question)}</li>`).join('')}</ul>` : ''}
    ${unassigned.length ? '<p>Some of your input is not included yet.</p>' : ''}
    ${excluded.length ? `<p>Other detected asset types not included: ${excluded.map((type) => escape(assetName(type))).join(', ')}</p>` : ''}
    <p class="helper">Update the fields to include missing details.</p>
  </section>` : '';
  const choose = !reviewAsset && clarification?.questions.includes('Which one asset should this plan include?') && (options.candidateAssetTypes?.length ?? 0) > 1 ? `<section class="panel" aria-labelledby="choose-heading">
    <h2 id="choose-heading">Choose one asset</h2>
    <p class="helper">Only the selected asset will be included in this plan.</p>
    <form method="post" action="${path}">
      <input type="hidden" name="csrf" value="${csrf}">
      <input type="hidden" name="action" value="choose">
      <fieldset class="confirmations"><legend>Detected asset types</legend>
        ${(options.candidateAssetTypes ?? []).map((type) => `<label><input type="radio" name="assetType" value="${escape(type)}" required><span>${escape(assetName(type))}</span></label>`).join('')}
      </fieldset>
      <button type="submit" ${busy ? 'disabled' : ''}>Continue with this asset</button>
    </form>
  </section>` : '';
  const restartForm = `<form class="restart-form" method="post" action="${path}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="action" value="restart"><button class="manual-link" type="submit">Start over</button></form>`;
  const reviewActions = `<div class="review-actions">${options.editableInput !== undefined ? `<button class="button-secondary" type="button" data-open-change ${busy ? 'disabled' : ''}>Edit input</button>` : ''}${restartForm}</div>`;
  const revisionDialog = options.editableInput !== undefined ? `<dialog class="change-dialog" aria-labelledby="change-heading">
    <form id="compose-form" method="post" enctype="multipart/form-data" action="${path}">
      <input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="action" value="revise">
      <div class="dialog-heading"><h2 id="change-heading">Edit input</h2><button class="dialog-close" type="button" data-close-change aria-label="Close" title="Close">${icon('xmark')}</button></div>
      <p class="helper">Edit your original text and get a new suggestion. Your current draft stays available if the suggestion fails.</p>
      <div class="field"><label for="message">Asset details</label><textarea id="message" name="message" rows="8" maxlength="${localPlanInputLimits.message}" aria-describedby="message-count">${escape(options.messageValue ?? options.editableInput)}</textarea><small id="message-count" class="helper" aria-live="off"></small></div>
      <div class="dialog-actions"><button type="submit" ${busy ? 'disabled' : ''}>Suggest again</button></div>
    </form>
  </dialog>` : '';
  const multiReview = draft?.assets && draft.assets.length > 1 ? `<section class="panel" aria-labelledby="review-heading">
    <div class="review-heading"><div class="panel-heading"><h2 id="review-heading">Review plan</h2><p class="helper">Check the plan details and assets before creating.</p></div>${reviewActions}</div>
    ${attention}
    <form method="post" action="${path}">
      <input type="hidden" name="csrf" value="${csrf}">
      <input type="hidden" name="action" value="create">
      <div class="section-heading"><h3>Plan details</h3></div>
      <div class="field"><label for="title">Plan title</label><input id="title" name="title" maxlength="200" required value="${escape(options.hints?.title || draft.title)}"></div>
      ${descriptionField}
      <div class="field"><label for="team">Audience</label><select id="team" name="teamId"><option value="">Personal</option>${(options.teams ?? []).map((team) => `<option value="${escape(team.id)}" ${options.selectedTeamId === team.id ? 'selected' : ''}>${escape(team.name)}</option>`).join('')}</select></div>
      <input type="hidden" name="additionalAssetCount" value="0"><div class="section-heading"><h3 data-asset-count>Data · ${draft.assets.length} assets</h3><button class="button-secondary section-add" type="button" data-add-review-asset>${icon('plus')} Add asset</button></div>
      <div class="asset-list" data-review-assets data-base-count="${draft.assets.length}">${draft.assets.map((asset, index) => `<details class="asset-card" data-asset-index="${index}">
        <summary class="asset-card-header"><span class="asset-card-icon">${assetIcon(asset.type)}</span><span class="asset-card-title"><strong>${escape(asset.name)}</strong><small>${escape(assetName(asset.type))}</small></span><span class="asset-card-actions">${assetMagic(index, asset.type)}<button class="asset-action" type="button" data-remove-asset aria-label="Remove asset" title="Remove asset">${icon('xmark')}</button></span><span class="asset-chevron">${icon('chevron')}</span></summary>
        <div class="asset-card-body"><div class="field"><label for="name-${index}">Asset name</label><input id="name-${index}" name="name:${index}" maxlength="200" required value="${escape(asset.name)}"></div><div class="field"><label for="type-${index}">Asset type</label><input id="type-${index}" readonly value="${escape(assetName(asset.type))}"></div><div class="protected-section">${protectedDataHeading()}<div class="protected-fields">
        ${Object.keys(asset.fields).map((field) => reviewField(field, asset.type, `field:${index}:${field}`, options.fieldValuesByAsset?.[index]?.[field])).join('')}
        ${quickPlanAssetCatalog.find(({ id }) => id === asset.type)?.fields.some((field) => !(field in asset.fields)) ? `<details class="add-field-details"><summary>${icon('plus')} Add another field</summary><div class="asset-card-body">${quickPlanAssetCatalog.find(({ id }) => id === asset.type)!.fields.filter((field) => !(field in asset.fields)).map((field) => reviewField(field, asset.type, `field:${index}:${field}`)).join('')}</div></details>` : ''}</div></div></div>
      </details>`).join('')}</div>
      <template id="review-asset-template">${blankAssetCard(0)}</template>
      <button type="submit" ${busy ? 'disabled' : ''}>Create plan</button>
    </form>
    ${assetMagicDialog()}
    ${revisionDialog}
  </section>` : '';
  const review = multiReview || (reviewAsset ? `<section class="panel" aria-labelledby="review-heading">
    <div class="review-heading">
      <div class="panel-heading"><h2 id="review-heading">Review plan</h2><p class="helper">Check the plan details and assets before creating.</p></div>
      ${reviewActions}
    </div>
    ${attention}
    ${draft ? `<form id="asset-type-form" method="post" action="${path}" hidden>
      <input type="hidden" name="csrf" value="${csrf}">
      <input type="hidden" name="action" value="choose">
    </form>` : ''}
    <form method="post" action="${path}">
      <input type="hidden" name="csrf" value="${csrf}">
      <input type="hidden" name="action" value="create">
      ${draft ? '<input type="hidden" name="additionalAssetCount" value="0">' : '<input type="hidden" name="manualAssetCount" value="1">'}
      <div class="section-heading"><h3>Plan details</h3></div>
      <div class="field">
        <label for="title">Plan title</label>
        <input id="title" name="title" maxlength="200" required value="${escape(options.hints?.title || reviewAsset.title)}">
      </div>
      ${descriptionField}
      <div class="field">
        <label for="team">Audience</label>
        <select id="team" name="teamId">
          <option value="" ${options.selectedTeamId ? '' : 'selected'}>Personal</option>
          ${(options.teams ?? []).map((team) => `<option value="${escape(team.id)}" ${options.selectedTeamId === team.id ? 'selected' : ''}>${escape(team.name)}</option>`).join('')}
        </select>
      </div>
      ${!draft && options.originalInputs?.length ? `<details class="original-input"><summary>${icon('eye')} View previous input</summary>${options.originalInputs.map((input) => `<pre>${escape(input)}</pre>`).join('')}</details>` : ''}
      <div class="section-heading"><h3 data-asset-count>Data · 1 asset</h3><button class="button-secondary section-add" type="button" ${draft ? 'data-add-review-asset' : 'data-add-asset'}>${icon('plus')} Add asset</button></div>
      <div class="asset-list" ${draft ? 'data-review-assets data-base-count="1"' : 'data-manual-assets'}><details class="asset-card" data-asset-index="0" open><summary class="asset-card-header"><span class="asset-card-icon">${assetIcon(reviewAsset.type)}</span><span class="asset-card-title"><strong>${escape(reviewAsset.name || 'New asset')}</strong><small>${escape(assetName(reviewAsset.type))}</small></span><span class="asset-card-actions">${assetMagic(0, reviewAsset.type)}<button class="asset-action" type="button" data-remove-asset aria-label="Remove asset" title="Remove asset">${icon('xmark')}</button></span><span class="asset-chevron">${icon('chevron')}</span></summary>
        <div class="asset-card-body"><div class="field"><label for="name">Asset name</label><input id="name" name="name" maxlength="200" required value="${escape(reviewAsset.name)}"></div>${draft ? `<div class="field"><label for="assetType">Asset type</label><div class="asset-type-controls"><select id="assetType" name="assetType" form="asset-type-form">${quickPlanAssetCatalog.map(({ id }) => `<option value="${escape(id)}" ${id === reviewAsset.type ? 'selected' : ''}>${escape(assetName(id))}</option>`).join('')}</select><button class="button-secondary icon-button" type="submit" form="asset-type-form" aria-label="Fill fields for selected asset type" title="Fill fields for selected asset type" ${busy ? 'disabled' : ''}>${icon('sparkles')}</button></div></div>` : `<div class="field"><label for="type-0">Asset type</label><select id="type-0" name="type:0" data-manual-type>${quickPlanAssetCatalog.map(({ id }) => `<option value="${escape(id)}" ${id === reviewAsset.type ? 'selected' : ''}>${escape(assetName(id))}</option>`).join('')}</select></div>`}<div class="protected-section">${protectedDataHeading()}<div class="protected-fields"><div data-manual-fields>${reviewAsset.fields.map((field) => reviewField(field, reviewAsset.type, `field:${field}`, draft && field in draft.asset.fields ? options.fieldValues[field] : undefined)).join('')}</div>
        ${draft && assetDefinition?.fields.some((field) => !reviewAsset.fields.includes(field)) ? `<details class="add-field-details"><summary>${icon('plus')} Add another field</summary><div class="asset-card-body">${assetDefinition.fields.filter((field) => !reviewAsset.fields.includes(field)).map((field) => reviewField(field, reviewAsset.type, `field:${field}`)).join('')}</div></details>` : ''}</div></div></div>
      </details></div>
      <template id="review-asset-template">${blankAssetCard(0)}</template>
      <button type="submit" ${busy ? 'disabled' : ''}>Create plan</button>
    </form>
    ${assetMagicDialog()}
    ${revisionDialog}
  </section>` : '');
  const compose = !reviewAsset ? `<section class="panel" aria-labelledby="compose-heading">
    <div class="panel-heading">
      <h2 id="compose-heading">${clarification ? 'Add one detail' : 'Describe assets'}</h2>
      ${clarification ? '' : '<p class="helper">Paste or describe the values you want to protect. Review the suggested assets in the next step.</p>'}
    </div>
    ${clarification && !choose ? `<div class="follow-up"><strong>${clarification.questions.length === 1 ? escape(clarification.questions[0]!) : 'A few details are needed'}</strong>${clarification.questions.length > 1 ? `<ul>${clarification.questions.map((question) => `<li>${escape(question)}</li>`).join('')}</ul>` : ''}<p class="helper">Add only the missing detail.</p></div>` : ''}
    ${clarification && options.originalInputs?.length ? `<details class="original-input"><summary>${icon('eye')} Previous input saved · View</summary>${options.originalInputs.map((input) => `<pre>${escape(input)}</pre>`).join('')}</details>` : ''}
    <form id="compose-form" method="post" enctype="multipart/form-data" action="${path}">
      <input type="hidden" name="csrf" value="${csrf}">
      <input type="hidden" name="action" value="infer">
      <div class="field">
        <label for="message">${clarification ? 'Your answer' : 'Asset details'}</label>
        <textarea id="message" name="message" rows="${clarification ? '2' : '4'}" maxlength="${localPlanInputLimits.message}" aria-describedby="message-count" autofocus placeholder="${clarification ? 'Add only the missing detail' : 'Service login: user@example.com, password: example-value'}">${escape(options.messageValue ?? '')}</textarea>
        <small id="message-count" class="helper" aria-live="off"></small>
      </div>
      <div class="field">
        <label for="file">Optional text file</label>
        <input id="file" name="file" type="file" accept=".env,.json,.txt,text/plain,application/json" aria-describedby="file-help">
        <small id="file-help" class="helper">.env, .json or .txt · up to ${localPlanInputLimits.file.toLocaleString('en-US')} characters or ${localPlanInputLimits.fileBytes / 1_024} KiB · ${localPlanInputLimits.total.toLocaleString('en-US')} characters across this session.</small>
      </div>
      <div class="compose-actions"><button type="submit" ${busy ? 'disabled' : ''}>${clarification ? 'Continue' : 'Suggest assets'}</button><button class="manual-link" type="submit" data-manual formnovalidate ${busy ? 'disabled' : ''}>Set up manually</button></div>
    </form>
    ${options.hasPreviousInput ? restartForm : ''}
  </section>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Create plan · Inheriti® Business</title>
  <style>${options.fontUrl ? `@font-face { font-family: AppFont; src: url('${options.fontUrl}') format('truetype'); font-weight: 200 800; font-display: swap; }` : ''}${options.iconFontUrl ? `@font-face { font-family: FontAwesome6; src: url('${options.iconFontUrl}') format('truetype'); font-weight: 900; font-display: block; }` : ''}${style}</style>
</head>
<body>
<main>
  <header class="page-header">
    <p class="eyebrow">Inheriti Business</p>
    <h1>Create plan</h1>
    <p class="subtitle">Create assets for a protection plan.</p>
    ${!reviewAsset && !clarification && !options.hasPreviousInput ? '<div class="secure-notice"><strong>Secure session</strong><span>Your message is processed on this device. Only the reviewed plan is sent when you create it.</span></div>' : ''}
    ${options.context ? `<p class="context">Organisation: ${escape(options.context)}</p>` : ''}
  </header>
  <ol class="steps" aria-label="Plan creation steps"><li class="${reviewAsset ? 'complete' : 'current'}" ${reviewAsset ? '' : 'aria-current="step"'}><span class="step-number">1</span>Assets</li><li class="${reviewAsset ? 'current' : ''}" ${reviewAsset ? 'aria-current="step"' : ''}><span class="step-number">2</span>Review plan</li></ol>
  ${message ? `<p class="status" role="${error ? 'alert' : 'status'}">${escape(message)}</p>` : ''}
  ${choose}
  ${reviewAsset ? review : compose}
  <form class="cancel-form" method="post" action="${path}">
    <input type="hidden" name="csrf" value="${csrf}">
    <input type="hidden" name="action" value="cancel">
    <button class="cancel-link" type="submit">Cancel session</button>
  </form>
</main>
<script nonce="${options.scriptNonce}">
  let pending;
  const assetCatalog = ${JSON.stringify(quickPlanAssetCatalog.map(({ id, fields, iconName }) => ({ id, fields, name: assetName(id), icon: assetIconCodePoints[iconName] ?? icons.file })))};
  const fieldLabels = ${JSON.stringify(fieldLabels)};
  const makeManualField = (field, type, index) => {
    const inputName = index ? 'field:' + index + ':' + field : 'field:' + field;
    const label = fieldLabels[field] || field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, char => char.toUpperCase());
    const row = document.createElement('div'); row.className = 'asset-field';
    const fieldLabel = document.createElement('label'); fieldLabel.htmlFor = 'field-' + index + '-' + field; fieldLabel.textContent = label;
    const input = document.createElement('textarea'); input.id = fieldLabel.htmlFor; input.name = inputName; input.rows = type === 'PLAIN-TEXT' ? 5 : 2; input.autocomplete = 'off';
    row.append(fieldLabel, input);
    return row;
  };
  const updateManualCard = (card, index) => {
    const type = card.querySelector('[data-manual-type]').value;
    const definition = assetCatalog.find(item => item.id === type);
    if (!definition) return;
    card.querySelector('[data-manual-fields]').replaceChildren(...definition.fields.map(field => makeManualField(field, type, index)));
    card.querySelector('.asset-card-title small').textContent = definition.name;
    card.querySelector('.asset-card-icon .fa-icon').textContent = String.fromCodePoint(definition.icon);
  };
  const updateMessageCount = () => {
    const message = document.getElementById('message');
    const count = document.getElementById('message-count');
    if (message && count) count.textContent = message.value.length.toLocaleString() + ' / ${localPlanInputLimits.message.toLocaleString('en-US')} characters';
  };
  const validate = () => {
    const form = document.getElementById('compose-form');
    if (!form) return;
    const message = form.elements.namedItem('message');
    const file = form.elements.namedItem('file');
    message.setCustomValidity(message.value.trim() || file?.files?.length ? '' : 'Enter a message or select a text file.');
  };
  let activeMagicCard;
  const busy = (value) => document.querySelectorAll('form:not(.cancel-form) button[type="submit"], [data-open-change], [data-add-asset], [data-add-review-asset], [data-remove-asset], [data-open-asset-magic], [data-suggest-asset]').forEach((button) => { button.disabled = value; });
  const showFieldPanel = (row, kind) => {
    row.querySelectorAll('[data-toggle-field]').forEach((toggle) => { toggle.setAttribute('aria-expanded', String(toggle.dataset.toggleField === kind)); });
    row.querySelectorAll('[data-field-panel]').forEach((panel) => { panel.hidden = panel.dataset.fieldPanel !== kind; });
  };
  const suggestAsset = async (button) => {
    const card = activeMagicCard;
    const dialog = document.querySelector('[data-asset-dialog]');
    const prompt = dialog?.querySelector('[data-asset-prompt]');
    const status = dialog?.querySelector('[data-asset-suggestion-status]');
    if (!card || !prompt || !status) return;
    if (!prompt.value.trim()) { status.textContent = 'Paste a value first.'; prompt.focus(); return; }
    const body = new URLSearchParams({ csrf: card.closest('form').querySelector('[name=csrf]').value,
      action: 'suggest-asset', assetType: (card.querySelector('[data-manual-type]') ?? card.querySelector('[data-asset-type]')).value, assetPrompt: prompt.value });
    button.disabled = true; button.setAttribute('aria-busy', 'true'); status.textContent = '';
    try {
      const response = await fetch('${path}', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!response.ok) throw new Error('Suggestion unavailable');
      const suggestion = await response.json();
      for (const [field, value] of Object.entries(suggestion.fields)) {
        const input = [...card.querySelectorAll('textarea[name^="field:"]')].find((item) => item.name.endsWith(':' + field));
        if (input && typeof value === 'string') {
          input.value = value;
          const row = input.closest('.asset-field');
          if (row.querySelector('[data-field-panel="edit"]')) showFieldPanel(row, 'edit');
          input.closest('.add-field-details')?.setAttribute('open', '');
        }
      }
      const name = card.querySelector('input[name="name"], input[name^="name:"]');
      if (name && !name.value.trim() && suggestion.name) { name.value = suggestion.name; card.querySelector('.asset-card-title strong').textContent = name.value; }
      card.open = true;
      prompt.value = '';
      status.textContent = '';
      dialog.close();
      card.querySelector('.asset-card-header')?.focus();
    } catch { status.textContent = 'Could not suggest fields. Edit them directly or try a labeled value.'; }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  };
  document.addEventListener('input', event => {
    validate(); updateMessageCount();
    if (event.target?.name === 'name' || event.target?.name?.startsWith('name:')) {
      const heading = event.target.closest('.asset-card')?.querySelector('.asset-card-title strong');
      if (heading) heading.textContent = event.target.value || 'New asset';
    }
  });
  document.addEventListener('change', event => {
    validate();
    if (event.target?.matches('[data-manual-type]')) updateManualCard(event.target.closest('.asset-card'), Number(event.target.name.split(':')[1]));
  });
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const fieldToggle = event.target.closest('[data-toggle-field]');
    if (fieldToggle) {
      const row = fieldToggle.closest('.asset-field');
      showFieldPanel(row, fieldToggle.getAttribute('aria-expanded') === 'true' ? '' : fieldToggle.dataset.toggleField);
      return;
    }
    if (event.target.closest('[data-add-review-asset], [data-add-asset]')) {
      const list = document.querySelector('[data-review-assets], [data-manual-assets]');
      const counter = document.querySelector(list?.hasAttribute('data-review-assets') ? '[name=additionalAssetCount]' : '[name=manualAssetCount]');
      const index = Number(list?.dataset.baseCount || 0) + Number(counter?.value);
      if (list && counter && list.children.length < ${localPlanAssetLimit}) {
        const card = document.querySelector('#review-asset-template').content.firstElementChild.cloneNode(true);
        card.dataset.assetIndex = String(index);
        for (const element of card.querySelectorAll('[id], [name], label[for]')) {
          if (element.id) element.id = element.id.replace(/-0(?=$|-)/g, '-' + index);
          if (element.name) element.name = element.name.replace(/:0(?=:|$)/g, ':' + index);
          if (element.htmlFor) element.htmlFor = element.htmlFor.replace(/-0(?=$|-)/g, '-' + index);
        }
        updateManualCard(card, index);
        list.querySelectorAll('.asset-card').forEach(item => { item.open = false; });
        list.append(card); card.open = true; counter.value = String(Number(counter.value) + 1);
        list.closest('form').querySelector('button[type="submit"]:not([form])').disabled = false;
        document.querySelector('[data-asset-count]').textContent = 'Data · ' + list.children.length + (list.children.length === 1 ? ' asset' : ' assets');
        event.target.closest('button').disabled = list.children.length >= ${localPlanAssetLimit};
        card.querySelector('input[name^="name:"]').focus();
      }
    }
    if (event.target.closest('[data-open-asset-magic]')) {
      event.preventDefault(); event.stopPropagation();
      activeMagicCard = event.target.closest('.asset-card');
      const magic = document.querySelector('[data-asset-dialog]');
      magic.querySelector('[data-asset-prompt]').value = '';
      magic.querySelector('[data-asset-suggestion-status]').textContent = '';
      magic.showModal(); magic.querySelector('[data-asset-prompt]').focus();
    }
    if (event.target.closest('[data-remove-asset]')) {
      event.preventDefault(); event.stopPropagation();
      const card = event.target.closest('.asset-card');
      const list = card?.parentElement;
      if (list?.children.length) {
        const index = card.dataset.assetIndex;
        const marker = document.createElement('input'); marker.type = 'hidden'; marker.name = 'remove:' + index; marker.value = '1';
        list.closest('form').append(marker); card.remove();
        if (!list.children.length) list.closest('form').querySelector('button[type="submit"]:not([form])').disabled = true;
        document.querySelector('[data-asset-count]').textContent = 'Data · ' + list.children.length + (list.children.length === 1 ? ' asset' : ' assets');
        document.querySelector('[data-add-review-asset], [data-add-asset]').disabled = false;
      }
    }
    if (event.target.closest('[data-suggest-asset]')) void suggestAsset(event.target.closest('[data-suggest-asset]'));
    if (event.target.closest('[data-close-asset-magic]')) document.querySelector('[data-asset-dialog]')?.close();
    const dialog = document.querySelector('.change-dialog:not(.asset-dialog)');
    if (event.target.closest('[data-open-change]') && !pending) { dialog?.showModal(); dialog?.querySelector('#message')?.focus(); }
    if (event.target.closest('[data-close-change]')) dialog?.close();
  });
  document.addEventListener('submit', async (event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    event.preventDefault();
    const form = event.target;
    const body = new FormData(form);
    const action = event.submitter?.hasAttribute('data-manual') ? 'review' : body.get('action');
    if (action === 'review') body.set('action', 'review');
    if (pending && action !== 'cancel') return;
    if (action === 'cancel') pending?.abort();
    const controller = new AbortController();
    if (action !== 'cancel') pending = controller;
    const suggestionTimer = action === 'infer' || action === 'revise'
      ? setTimeout(() => controller.abort('suggestion_timeout'), ${localPlanSuggestionTimeoutMs}) : undefined;
    const button = event.submitter ?? form.querySelector('button[type="submit"]');
    const previousStatus = document.querySelector('main > .status');
    previousStatus?.remove();
    form.closest('dialog')?.querySelector('.status')?.remove();
    if (action === 'create' && (form.elements.namedItem('manualAssetCount') || form.elements.namedItem('additionalAssetCount'))) {
      const cards = form.elements.namedItem('manualAssetCount') ? [...form.querySelectorAll('[data-manual-assets] .asset-card')] : [...form.querySelectorAll('[data-added-asset]')];
      const missing = cards.find(card => ![...card.querySelectorAll('textarea[name^="field:"]')].some(input => input.value.trim()));
      if (missing) {
        const notice = document.createElement('p'); notice.className = 'status'; notice.setAttribute('role', 'alert'); notice.textContent = 'Add at least one value to each asset.';
        document.querySelector('main')?.prepend(notice); missing.querySelector('textarea[name^="field:"]')?.focus(); pending = undefined; return;
      }
    }
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    if (action !== 'cancel') busy(true);
    try {
      const response = await fetch(form.getAttribute('action'), { method: 'POST', body: action === 'infer' || action === 'review' || action === 'revise' ? body : new URLSearchParams(body), credentials: 'same-origin', signal: controller.signal });
      const next = new DOMParser().parseFromString(await response.text(), 'text/html').querySelector('main');
      if (!next) throw new Error('Invalid response');
      if (action !== 'cancel' && pending !== controller) return;
      if (response.status === 504 && (action === 'infer' || action === 'revise')) {
        const notice = document.createElement('p'); notice.className = 'status'; notice.setAttribute('role', 'alert');
        notice.textContent = next.querySelector('[role="alert"]')?.textContent || 'Suggestion timed out. Try again or set up the assets manually.';
        if (action === 'revise') document.querySelector('.change-dialog .dialog-heading')?.after(notice);
        else document.querySelector('main')?.prepend(notice);
        form.elements.namedItem('message')?.focus();
        return;
      }
      if (action === 'create' && !response.ok) {
        const notice = document.createElement('p'); notice.className = 'status'; notice.setAttribute('role', 'alert');
        notice.textContent = next.querySelector('[role="alert"]')?.textContent || 'Plan creation failed. Review and retry.';
        document.querySelector('main')?.prepend(notice); return;
      }
      document.querySelector('main').replaceWith(document.importNode(next, true));
      validate();
      updateMessageCount();
      if (action === 'revise' && !response.ok && document.querySelector('.change-dialog')) {
        document.querySelector('.change-dialog').showModal();
        document.getElementById('message')?.focus();
      } else if (document.getElementById('compose-heading')) document.getElementById('message')?.focus();
    } catch (error) {
      if (error.name !== 'AbortError' || controller.signal.reason === 'suggestion_timeout') {
        document.querySelector('main > .status')?.remove();
        const notice = document.createElement('p');
        notice.className = 'status';
        notice.setAttribute('role', 'alert');
        notice.textContent = controller.signal.reason === 'suggestion_timeout'
          ? 'Suggestion took longer than 90 seconds. Try again or set up the assets manually.'
          : 'Unable to continue. Check the local session and try again.';
        if (action === 'revise') document.querySelector('.change-dialog .dialog-heading')?.after(notice);
        else document.querySelector('main')?.prepend(notice);
      }
    } finally {
      if (suggestionTimer) clearTimeout(suggestionTimer);
      if (pending === controller) pending = undefined;
      if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
      if (action !== 'cancel' && !pending) {
        busy(false);
        const assetList = document.querySelector('[data-review-assets], [data-manual-assets]');
        if (assetList) {
          assetList.querySelectorAll('[data-remove-asset]').forEach(remove => { remove.disabled = false; });
          assetList.closest('form').querySelector('button[type="submit"]:not([form])').disabled = assetList.children.length === 0;
          document.querySelector('[data-add-review-asset], [data-add-asset]').disabled = assetList.children.length >= ${localPlanAssetLimit};
        }
      }
    }
  });
  validate();
  updateMessageCount();
</script>
</body>
</html>`;
}

export function renderLocalPlanResultPage(created: unknown, fontUrl?: string): string {
  const value = created && typeof created === 'object' ? created as Record<string, unknown> : {};
  const status = value.status === 'READY' || value.status === 'PENDING' ? value.status : null;
  const planId = typeof value.planId === 'string' && value.planId.length <= 200 ? value.planId : null;
  const heading = status === 'READY' ? 'Plan ready' : status === 'PENDING' ? 'Plan pending' : 'Plan creation completed';
  const description = status === 'PENDING' ? 'Creation is still processing. Check the plan status in Inheriti Business.' : 'You can close this window and return to your workflow.';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${heading} · Inheriti Business</title>
  <style>${fontUrl ? `@font-face { font-family: AppFont; src: url('${fontUrl}') format('truetype'); font-weight: 200 800; font-display: swap; }` : ''}${style}</style>
</head>
<body>
  <main><section class="panel" role="status">
    <h1>${heading}</h1>
    <p>${description}</p>
    ${planId ? `<small class="helper">Plan ID: ${escape(planId)}</small>` : ''}
  </section></main>
</body>
</html>`;
}

export function renderLocalPlanCanceledPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Session canceled · Inheriti Business</title><style>${style}</style></head>
  <body><main><section class="panel" role="status"><h1>Session canceled</h1><p>You can close this window and return to your workflow.</p></section></main></body></html>`;
}
