import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChecklistRows } from '@modules/importer-preview/FinalStagingChecklist/components/ChecklistRows';
import { FileRow } from '@modules/importer-preview/SourceImportStatus/components/FileRow';

afterEach(cleanup);

describe('import activity icons', () => {
  it('spins only a loading checklist icon', () => {
    const { container, rerender } = render(
      <ChecklistRows
        items={[{ label: 'Secure staging', detail: 'Encrypting', complete: false, loading: true }]}
        planProgress
      />,
    );
    expect(container.querySelectorAll('.importer-icon-spinner')).toHaveLength(1);

    rerender(
      <ChecklistRows
        items={[{ label: 'Secure staging', detail: 'Ready', complete: false }]}
        planProgress
      />,
    );
    expect(container.querySelector('.importer-icon-spinner')).toBeNull();
  });

  it('spins the retrying status badge but keeps the retry action icon still', () => {
    const { container, rerender } = render(
      <FileRow file={{ name: 'source.csv', format: 'CSV', status: 'retrying' }} />,
    );
    expect(container.querySelectorAll('.importer-icon-spinner')).toHaveLength(1);

    rerender(
      <FileRow file={{ name: 'source.csv', format: 'CSV', status: 'failed' }} onRetry={() => {}} />,
    );
    expect(container.querySelector('.importer-icon-spinner')).toBeNull();
  });
});
