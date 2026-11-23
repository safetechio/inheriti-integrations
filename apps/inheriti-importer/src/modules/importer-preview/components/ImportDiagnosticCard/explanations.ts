import type { ImportDiagnostic } from '@modules/import/domain/import-diagnostic';

type Explanation = { reason: string; outcome: string };

const explanations: Record<string, Explanation> = {
  'onepassword-recovery-limit': {
    reason: 'This entry exceeded the limit for inspecting nested source values safely.',
    outcome:
      'The affected field was left out. Keep the original export to retrieve it manually; other readable entries remain available.',
  },
  'duplicate-source-entry-id': {
    reason: 'More than one source entry used the same identifier.',
    outcome: 'The importer assigned separate identifiers so the entries remain distinct.',
  },
  'onepassword-attachments': {
    reason:
      'The 1Password import reads credential fields and has no destination for attached files.',
    outcome: 'The archive attachments were left out of the import.',
  },
  'onepassword-file-only-item': {
    reason: 'This item contained a file and had no readable credential fields.',
    outcome: 'The importer skipped the item because it cannot import the file.',
  },
  'onepassword-item-file': {
    reason: 'The 1Password import has no destination for item files.',
    outcome: 'The importer kept the entry for review and left out its file content.',
  },
  'onepassword-container-metadata': {
    reason: 'These properties describe the export, account, or vault in 1Password.',
    outcome: 'The importer omitted the reported properties from imported entries.',
  },
  'onepassword-password-history': {
    reason: 'These values are previous versions of a password.',
    outcome: 'The importer kept the readable history in a protected field for manual mapping.',
  },
  'onepassword-item-metadata': {
    reason: 'These properties describe the item’s timestamps or state in 1Password.',
    outcome: 'The importer omitted the reported administrative metadata.',
  },
  'onepassword-login-settings': {
    reason: 'Login field metadata can describe a field or control browser autofill.',
    outcome:
      'The importer may use identifiers and types to recognize fields. Browser autofill behavior stays in 1Password.',
  },
  'onepassword-url-metadata': {
    reason: 'The reported settings control how 1Password matches websites.',
    outcome:
      'The importer omitted matching settings, kept primary labels for manual mapping, and used alternative labels in their URL field names.',
  },
  'onepassword-field-settings': {
    reason: 'This metadata can include a field identifier or presentation options.',
    outcome:
      'The importer may retain the identifier. Field display and editing behavior stays in 1Password.',
  },
  'onepassword-extra-properties': {
    reason: 'These additional properties have no dedicated field in the normalized source entry.',
    outcome: 'The importer kept the readable content as text or JSON for review.',
  },
  'onepassword-unreadable-properties': {
    reason: 'The properties included content that the 1Password import does not handle.',
    outcome: 'The importer left out the unsupported portions.',
  },
  'onepassword-unreadable-field': {
    reason: 'The importer could not read this field or encountered unsupported content.',
    outcome: 'The importer left out the unreadable or unsupported content.',
  },
  'onepassword-partial-recovery': {
    reason: 'The source combined readable values with unsupported content.',
    outcome: 'The importer kept the readable values for review and omitted the unsupported parts.',
  },
  'onepassword-field-json': {
    reason: 'The source stored the field as a structured value.',
    outcome: 'The importer represented the structure as JSON for review.',
  },
  'onepassword-field-text': {
    reason: 'The source used a typed value and the importer reads these fields as text.',
    outcome: 'The importer converted the value to text. Empty results do not create fields.',
  },
  'k8s-docker-unreadable-payload': {
    reason: 'The Docker configuration could not be read as individual credentials.',
    outcome: 'The importer kept the original value in a protected field for manual mapping.',
  },
  'keepass-unreadable-protected-field': {
    reason: 'The importer could not read the protected field from KeePass.',
    outcome: 'The importer omitted that field and kept other readable fields.',
  },
  'cloud-unsupported-record': {
    reason: 'The cloud export record contained no supported secret payload.',
    outcome: 'The importer skipped the record.',
  },
  'dotenv-malformed-line': {
    reason: 'The line did not form a valid environment variable assignment.',
    outcome: 'The importer skipped the malformed line.',
  },
  'passbolt-unrecognized-rows': {
    reason: 'These records did not match the supported Passbolt credential format.',
    outcome: 'The importer skipped the unrecognized records.',
  },
  'passbolt-resource-metadata': {
    reason:
      'These properties describe the resource in Passbolt, such as its timestamps or ownership.',
    outcome: 'The importer omitted the reported administrative metadata.',
  },
  'passbolt-value-text': {
    reason: 'The source included non-text values and the importer uses text fields.',
    outcome: 'The importer represented the affected values as text or JSON for review.',
  },
};

const fallback: Record<ImportDiagnostic['kind'], Explanation> = {
  unsupported: {
    reason: 'The importer flagged this content as unsupported.',
    outcome: 'The warning does not specify how the affected content was handled.',
  },
  skipped: {
    reason: 'The warning does not identify a more specific reason.',
    outcome: 'The importer skipped the reported content.',
  },
  transformed: {
    reason: 'The warning does not identify why a conversion was needed.',
    outcome: 'The importer changed the representation of the reported content.',
  },
};

export function diagnosticExplanation(code: string | undefined, kind: ImportDiagnostic['kind']) {
  return code && Object.hasOwn(explanations, code) ? explanations[code] : fallback[kind];
}
