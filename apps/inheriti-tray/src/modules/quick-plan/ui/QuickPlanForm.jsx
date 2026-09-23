import { TextField, SelectField } from '../../_shared/ui/components/Form/Fields.jsx';
import { isMedia } from './asset-input.js';

const omittedFields = new Set(['blockchain', 'customBlockchain', 'wallet', 'customWallet']);

export function QuickPlanForm({ messages, state, form, setForm, onReview, onCancel, error, preparing, editMode = false }) {
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

  return <form id="capture" onSubmit={onReview}>
    <h2>{editMode ? messages.addAsset : messages.savePlan}</h2>
    {!editMode && <TextField
      id="title" label={messages.planTitle} value={form.title}
      onChange={(title) => update({ title })} maxLength={200} required disabled={preparing}
    />}
    {!editMode && <SelectField
      id="audience" label={messages.audience} value={form.audience}
      onChange={(audience) => update({ audience })}
      options={[
        { value: 'private', label: messages.privateAudience },
        { value: 'team', label: messages.teamAudience },
      ]}
      required disabled={preparing}
    />}
    {!editMode && form.audience === 'team' && <SelectField
      id="team" label={messages.team} value={form.teamId}
      onChange={(teamId) => update({ teamId })}
      options={teamOptions} required disabled={preparing}
    />}
    <SelectField
      id="asset-type" label={messages.assetType} value={form.assetType}
      onChange={(assetType) => update({ assetType, assetName: '', fields: {}, file: null })}
      options={assetOptions} required disabled={preparing}
    />
    <TextField
      id="asset-name" label={messages.assetName} value={form.assetName}
      onChange={(assetName) => update({ assetName })} maxLength={200} required disabled={preparing}
    />
    {definition && (isMedia(definition)
      ? <div className="field">
          <label htmlFor="asset-file">{messages.assetFile}</label>
          <input
            id="asset-file" name="asset-file" type="file" required disabled={preparing}
            accept={definition.id === 'IMAGE' ? 'image/*' : definition.id === 'VIDEO' ? 'video/*' : 'application/pdf,.pdf,.doc,.docx,.txt'}
            onChange={(event) => update({ file: event.target.files?.[0] || null })}
          />
        </div>
      : definition.fields.filter((field) => !omittedFields.has(field)).map((field) =>
          <TextField
            key={field} id={`asset-${field}`} label={messages.assetFields[field] || field}
            value={form.fields[field] || ''} onChange={(value) => updateField(field, value)}
            type={/password|privateKey|apiKey|pinCode|code/i.test(field) ? 'password' : field === 'email' ? 'email' : 'text'}
            multiline={field === 'text' || field === 'words'} disabled={preparing}
          />))}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="buttons">
      <button id="cancel-capture" type="button" onClick={onCancel} disabled={preparing}>{messages.cancel}</button>
      <button type="submit" disabled={preparing}>{editMode ? messages.addAsset : messages.review}</button>
    </div>
  </form>;
}
