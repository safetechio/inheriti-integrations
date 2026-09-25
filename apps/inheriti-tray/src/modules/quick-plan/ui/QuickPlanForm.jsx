import { Box } from '../../_shared/ui/components/Box.jsx';
import { Text } from '../../_shared/ui/components/Text.jsx';
import { TextField } from '../../_shared/ui/components/Form/TextField.jsx';
import { SelectField } from '../../_shared/ui/components/Form/SelectField.jsx';
import { AssetFields } from './components/AssetFields.jsx';
import { ScreenHeader } from '../../_shared/ui/components/ScreenHeader.jsx';
import { ScreenFooter } from '../../_shared/ui/components/ScreenFooter.jsx';

export function QuickPlanForm({ messages, state, form, setForm, onReview, onCancel, error, preparing, editMode = false, replaceMode = false }) {
  const definition = state.assetCatalog.find(({ id }) => id === form.assetType);
  const update = (changes) => setForm((current) => ({ ...current, ...changes }));
  const updateField = (name, value) => setForm((current) => ({
    ...current,
    fields: { ...current.fields, [name]: value },
  }));
  const assetOptions = [
    { value: '', label: messages.chooseAssetType },
    ...state.assetCatalog.map(({ id }) => ({ value: id, label: messages.assetTypes[id] || id })),
  ];
  const teamOptions = [
    { value: '', label: messages.chooseTeam },
    ...state.teams.map(({ id, name }) => ({ value: id, label: name })),
  ];

  const organizationName = state.organizations.find(({ id }) => id === state.selectedId)?.name || '';
  const fields = <>
    {!editMode && <TextField
      id="title" label={messages.planTitle} value={form.title}
      onChange={(title) => update({ title })} maxLength={200} required disabled={preparing}
    />}
    {!editMode && <fieldset className="plan-audience"><legend>{messages.audience}</legend>
      <input id="audience" type="hidden" value={form.audience} disabled={preparing} readOnly />
      <div className="plan-audience-options">
        <label data-selected={form.audience === 'team'}><input type="radio" name="audience" value="team" checked={form.audience === 'team'} onChange={() => update({ audience: 'team' })} disabled={preparing} />{messages.teamAudience}</label>
        <label data-selected={form.audience === 'private'}><input type="radio" name="audience" value="private" checked={form.audience === 'private'} onChange={() => update({ audience: 'private' })} disabled={preparing} />{messages.privateAudience}</label>
      </div>
      {form.audience === 'private' && <small>{messages.privateDescription}</small>}
    </fieldset>}
    {!editMode && form.audience === 'team' && <SelectField
      id="team" label={messages.team} value={form.teamId}
      onChange={(teamId) => update({ teamId })}
      options={teamOptions} required disabled={preparing}
    />}
    <SelectField
      id="asset-type" label={messages.assetType} value={form.assetType}
      onChange={(assetType) => update({ assetType, assetName: '', fields: {}, file: null })}
      options={assetOptions} required disabled={preparing || replaceMode}
    />
    <TextField
      id="asset-name" label={messages.assetName} value={form.assetName}
      onChange={(assetName) => update({ assetName })} maxLength={200} required disabled={preparing}
    />
    {definition && <AssetFields definition={definition} form={form} messages={messages}
      update={update} updateField={updateField} disabled={preparing} />}
    {error && <Text as="p" variant="bodySmall" className="error" role="alert">{error}</Text>}
  </>;
  const actions = <Box className="buttons plan-form-actions">
    <button className="button-secondary" id="cancel-capture" type="button" onClick={onCancel} disabled={preparing}>{messages.cancel}</button>
    <button type="submit" disabled={preparing}>{replaceMode ? messages.saveAssetChanges : editMode ? messages.addAsset : messages.review}</button>
  </Box>;

  if (!editMode && !replaceMode) return <form id="capture" className="tray-screen plan-form" onSubmit={onReview}>
    <ScreenHeader title={messages.savePlan} organizationName={organizationName} onBack={onCancel} step={1} />
    <div className="tray-scroll plan-form-fields">{fields}</div>
    <ScreenFooter>{actions}</ScreenFooter>
  </form>;

  return <form id="capture" onSubmit={onReview}>
    <Text as="h2" variant="heading3">{replaceMode ? messages.editAsset : messages.addAsset}</Text>
    {fields}
    <Box className="buttons">
      <button className="button-secondary" id="cancel-capture" type="button" onClick={onCancel} disabled={preparing}>{messages.cancel}</button>
      <button type="submit" disabled={preparing}>{replaceMode ? messages.saveAssetChanges : editMode ? messages.addAsset : messages.review}</button>
    </Box>
  </form>;
}
