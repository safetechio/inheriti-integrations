import { Box, Icon, theme } from '@main-components';
import { useState } from 'react';

export function ReviewSourceToolbar({
  source,
  sources,
  search,
  onSourceChange,
  onSearchChange,
}: {
  source: string;
  sources: ReadonlyMap<string, string>;
  search: string;
  onSourceChange: (source: string) => void;
  onSearchChange: (query: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <Box flexDirection="row" alignItems="flex-end" gap="s" className="asset-review-toolbar">
      <label className="asset-review-source-label">
        Source
        <select
          aria-label="Filter by source"
          value={source}
          onChange={(event) => onSourceChange(event.target.value)}
        >
          <option value="all">All sources</option>
          {[...sources].map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {searchOpen ? (
        <Box flexDirection="row" alignItems="center" className="asset-review-search">
          <button
            type="button"
            aria-label="Close asset search"
            onClick={() => setSearchOpen(false)}
          >
            <Icon name="magnifying-glass" size={14} color={theme.colors.gray} />
          </button>
          <input
            autoFocus
            aria-label="Search assets"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search assets"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear asset search"
              onClick={() => onSearchChange('')}
            >
              ×
            </button>
          ) : null}
        </Box>
      ) : (
        <button
          type="button"
          className="asset-review-search-toggle"
          aria-label="Search assets"
          onClick={() => setSearchOpen(true)}
        >
          <Icon name="magnifying-glass" size={16} color={theme.colors.gray50} />
        </button>
      )}
    </Box>
  );
}
