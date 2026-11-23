import { useMemo, useState } from 'react';
import { importDiagnosticCategory } from '@modules/import/domain/import-diagnostic';
import type { ImportFile } from '../../SourceImportStatus';
import type { ImporterFlowStage } from './use-importer-flow';

export function useSourceOmissionConfirmation(
  files: ImportFile[],
  canLeaveSources: boolean,
  navigate: (stage: ImporterFlowStage) => void,
) {
  const { affectedSources, fileFingerprint } = useMemo(() => {
    const sources = files.map(({ id, name, format, diagnostics }) => ({
      id,
      name,
      format,
      diagnostics: (diagnostics ?? []).filter((diagnostic) => {
        const category = importDiagnosticCategory(diagnostic);
        return category === 'unsupported' || category === 'skipped';
      }),
    }));
    const fileKeys = sources.map(({ id, name, format, diagnostics }) =>
      JSON.stringify([id, name, format, diagnostics.map((item) => JSON.stringify(item)).sort()]),
    );
    return {
      affectedSources: sources.filter(({ diagnostics }) => diagnostics.length > 0),
      fileFingerprint: JSON.stringify(fileKeys.sort()),
    };
  }, [files]);
  const fingerprint = `${canLeaveSources}:${fileFingerprint}`;
  const [decision, setDecision] = useState<{
    fingerprint: string;
    confirmed?: boolean;
    destination?: ImporterFlowStage;
  }>({ fingerprint });
  const current = decision.fingerprint === fingerprint ? decision : { fingerprint };
  if (current !== decision) setDecision(current);

  const dismiss = () => setDecision({ fingerprint });
  return {
    sources: affectedSources,
    visible: canLeaveSources && current.destination !== undefined,
    dismiss,
    continueTo: (destination: ImporterFlowStage) => {
      if (!canLeaveSources) return;
      if (!affectedSources.length || current.confirmed) navigate(destination);
      else setDecision({ fingerprint, destination });
    },
    confirm: () => {
      if (!canLeaveSources || !current.destination) return;
      setDecision({ fingerprint, confirmed: true });
      navigate(current.destination);
    },
  };
}
