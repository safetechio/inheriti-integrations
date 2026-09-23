import { Box, Text } from 'ink';
import { moderatorDisplayName, type PlanDetail, type PlanSummary } from '@safetech/inheriti-elements-core';
import { Field, Heading, Table } from './table.js';
import { count, label, labels, timestamp } from './values.js';

/**
 * What `plans list` shows: one row per plan, and nothing an operator cannot act on.
 *
 * The pagination cursor is deliberately absent. It is a transport detail that carries the
 * Application id and the last row's position, and printing it in a listing puts that on any screen
 * the listing reaches. `--json` still returns it, because a script is the only caller that needs it.
 */
export function PlansList({ plans, more, width }: { plans: readonly PlanSummary[]; more: boolean; width: number }) {
  return (
    <Box flexDirection="column">
      <Table
        columns={[
          { header: 'name', value: (plan: PlanSummary) => plan.name, flexible: true, minimum: 12 },
          { header: 'id', value: (plan) => plan.id, dim: true },
          { header: 'status', value: (plan) => label(plan.status) },
          { header: 'assets', value: (plan) => assetNames(plan), flexible: true, minimum: 14 },
          { header: 'moderators', value: (plan) => count(plan.participantSummary?.moderators) },
          { header: 'authentication', value: (plan) => authentication(plan) },
          { header: 'created', value: (plan) => timestamp(plan.createdAt) },
        ]}
        rows={plans}
        width={width}
      />
      <Box marginTop={1}>
        <Text dimColor>
          {`${plans.length} plan${plans.length === 1 ? '' : 's'}`}
          {more ? ' · more available — --all fetches every page, --json returns the cursor' : ''}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * What `plans show` adds: the assets as they really are, and who is on the plan.
 *
 * The asset table is the metadata the plan service holds — type, addressable code, the field names a reveal
 * can ask for — never a value; a value only ever arrives through `plans reveal`, one field at a time.
 */
export function PlanView({ plan, width, keyOwner = 'Application' }: { plan: PlanDetail; width: number; keyOwner?: 'Application' | 'Organisation' }) {
  const assets = plan.assets ?? [];
  const people = plan.participants ?? [];
  return (
    <Box flexDirection="column">
      <Heading>{plan.name}</Heading>
      <Box flexDirection="column" marginTop={1}>
        <Field label="id" value={plan.id} />
        <Field label="description" value={plan.description ?? '—'} />
        <Field label="status" value={label(plan.status)} />
        <Field label="created" value={timestamp(plan.createdAt)} />
        <Field label="configured" value={timestamp(plan.configuredAt)} />
        <Field label="moderators" value={moderators(plan)} />
        <Field label="authentication" value={authentication(plan)} />
        <Field
          label="reveal policy"
          value={`${keyOwner} key required · custodian share required`}
        />
        <Field label="source" value={sourceOf(plan)} />
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Heading>{`Assets (${assets.length})`}</Heading>
        {assets.length === 0 ? <Text dimColor>None.</Text> : (
          <Table
            columns={[
              { header: 'code', value: (asset: PlanDetail['assets'][number]) => asset.code ?? asset.id },
              { header: 'type', value: (asset) => label(asset.type) },
              { header: 'name', value: (asset) => asset.name, flexible: true, minimum: 12 },
              { header: 'file', value: (asset) => file(asset), flexible: true, minimum: 10 },
              { header: 'fields', value: (asset) => (asset.fieldNames ?? []).join(', ') || '—', flexible: true, minimum: 10 },
              {
                header: 'autofill origins',
                value: (asset) => (asset.matchOrigins ?? []).join(', ') || '—',
                flexible: true,
                minimum: 10,
              },
            ]}
            rows={assets}
            width={width}
          />
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Heading>{`Participants (${people.length})`}</Heading>
        {people.length === 0 ? <Text dimColor>None.</Text> : (
          <Table
            columns={[
              {
                header: 'name',
                value: (person: PlanDetail['participants'][number]) => moderatorDisplayName(person.displayName, person.id),
                flexible: true,
                minimum: 12,
              },
              { header: 'roles', value: (person) => labels(person.relationships) },
              { header: 'lifecycle', value: (person) => label(person.lifecycle) },
            ]}
            rows={people}
            width={width}
          />
        )}
        <Text dimColor>
          Participant email addresses are not available to this integration.
        </Text>
      </Box>
    </Box>
  );
}

/** The names the developer gave the assets — far more use than the type codes they share. */
function assetNames(plan: PlanSummary): string {
  const names = plan.assetSummary?.names ?? [];
  if (names.length > 0) return names.join(', ');
  // An older plan service sends no names; the types are still better than an empty cell.
  return `${count(plan.assetSummary?.count)} ${labels(plan.assetSummary?.types, '')}`.trim();
}

function authentication(plan: PlanSummary): string {
  const methods = plan.authentication ?? [];
  if (methods.length === 0) return 'none';
  return methods.map((method) => `${label(method.id)} (${label(method.status)})`).join(', ');
}

function moderators(plan: PlanDetail): string {
  const named = (plan.participants ?? [])
    .filter((person) => (person.relationships ?? []).some((relationship) => label(relationship) === 'MODERATOR'))
    .map((person) => moderatorDisplayName(person.displayName, person.id));
  if (named.length > 0) return `${named.length} · ${named.join(', ')}`;
  return count(plan.participantSummary?.moderators);
}

/** A binary asset is a file: say which one, and say so even when the filename was never declared. */
function file(asset: PlanDetail['assets'][number]): string {
  if (!asset.isBinary) return '—';
  const name = asset.fileName ?? '(file)';
  return asset.mimeType ? `${name} · ${asset.mimeType}` : name;
}

function sourceOf(plan: PlanDetail): string {
  const source = plan.source;
  if (!source) return '—';
  if (source.kind === 'BRIDGED') return `BRIDGED ${label(source.system)} · ${label(source.status)}`;
  return label(source);
}
