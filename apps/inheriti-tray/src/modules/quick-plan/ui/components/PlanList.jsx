import { useState } from 'react';
import { planAvatarSvg } from '@safetech/inheriti-elements-brand';
export function PlanList({ options, value, onChange, disabled }) {
  const [pageSize, setPageSize] = useState(5);
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(options.length / pageSize));
  const page = Math.min(requestedPage, pageCount - 1);
  const visible = options.slice(page * pageSize, (page + 1) * pageSize);

  return <div className="edit-plan-picker">
    <div className="edit-plan-list" role="radiogroup" aria-labelledby="edit-plan-label">
      {visible.map((plan) => <label key={plan.id} className="edit-plan-row" data-plan-id={plan.id} data-selected={plan.id === value}>
        <input type="radio" name="edit-plan" value={plan.id} checked={plan.id === value} disabled={disabled} onChange={() => onChange(plan.id)} />
        <img className="edit-plan-avatar" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(planAvatarSvg(plan.id))}`} alt="" />
        <span className="edit-plan-details"><strong>{plan.name}</strong><small>{plan.assetNames?.[0] || 'Protected plan'}</small></span>
        {Number.isInteger(plan.assetCount) && <span className="edit-plan-count">{plan.assetCount} {plan.assetCount === 1 ? 'asset' : 'assets'}</span>}
      </label>)}
      {!options.length && <p className="edit-plan-no-match" role="status">No plans match your search.</p>}
    </div>
    {options.length > 5 && <div className="edit-plan-pagination">
      <div className="edit-plan-page-sizes"><span>Show</span>{[5, 10, 20, 50].map((size) => <button key={size} type="button" className={size === pageSize ? 'active' : ''} aria-label={`Show ${size} plans`} aria-pressed={size === pageSize} onClick={() => { setPageSize(size); setPage(0); onChange(''); }}>{size}</button>)}</div>
      {pageCount > 1 && <div className="edit-plan-pages"><button type="button" aria-label="Previous plan page" disabled={page === 0} onClick={() => { setPage(page - 1); onChange(''); }}>‹</button><span>{page + 1} / {pageCount}</span><button type="button" aria-label="Next plan page" disabled={page === pageCount - 1} onClick={() => { setPage(page + 1); onChange(''); }}>›</button></div>}
    </div>}
  </div>;
}
