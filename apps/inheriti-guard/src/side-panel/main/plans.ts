import { planAvatarSvg } from '@safetech/inheriti-elements-brand';
import { rowsFor, type PanelState } from '../../shared/plan-view.js';
import { actionButton, el, titleCase } from './dom.js';

export function planRows(state: PanelState, viewAssets: (planId: string) => void): HTMLLIElement[] {
  return rowsFor(state).map((row) => {
    const item = el('li');
    if (state.kind === 'PLANS') item.dataset.planRow = '';
    const heading = el('div', 'plan-row-heading');
    const planStatus = row.detail.toUpperCase();
    const tone = row.draft ? 'draft'
      : ['PROTECTED', 'ACTIVE', 'CONFIGURED', 'COMPLETED', 'DATA_RELEASED', 'DATA_REVEALED', 'ACCESS_GRANTED'].includes(planStatus) ? 'ready'
        : ['FAILED', 'ABORTED'].includes(planStatus) ? 'danger'
          : /^(MERGING_|PENDING|SHARES_|VALIDATOR_SHARES_|CUSTODIAN_SHARE_|EXPIRED$)/u.test(planStatus) ? 'warning' : 'neutral';
    const identity = el('div', 'plan-row-identity');
    if (row.avatarId) {
      const avatar = el('img', 'plan-avatar');
      avatar.alt = '';
      avatar.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(planAvatarSvg(row.avatarId))}`;
      identity.append(avatar);
    }
    identity.append(el('span', 'plan-label', row.label));
    heading.append(identity, el('span', `plan-detail ${tone}`, titleCase(row.detail)));
    item.append(heading);
    if (row.draft) item.append(el('span', 'plan-hint', 'Finish setup in Inheriti® Business to access this plan.'));
    if (row.planId !== undefined) {
      const planId = row.planId;
      item.dataset.planId = planId;
      const actions = el('div', 'plan-actions');
      const assets = actionButton('View assets', 'secondary');
      assets.addEventListener('click', () => { viewAssets(planId); });
      actions.append(assets);
      item.append(actions);
    }
    return item;
  });
}
