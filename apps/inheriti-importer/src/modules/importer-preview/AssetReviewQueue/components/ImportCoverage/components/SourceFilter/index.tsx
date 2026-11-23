import { ScrollableTabs } from '@main-components';

export function SourceFilter({
  sources,
  value,
  onChange,
}: {
  sources: ReadonlyMap<string, string>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ScrollableTabs
      label="Filter source field details by source"
      tabs={[
        { value: '', label: 'All', accessibilityLabel: 'All sources' },
        ...Array.from(sources, ([value, label]) => ({ value, label })),
      ]}
      value={value}
      onChange={onChange}
      variant="pill"
      scrollLabel="sources"
    />
  );
}
