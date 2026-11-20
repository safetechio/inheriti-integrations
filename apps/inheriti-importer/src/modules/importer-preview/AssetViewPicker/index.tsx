import { Box, Icon, theme } from '@main-components';
import './styles.css';

export function AssetViewPicker({ view, onChange }: { view: 'list' | 'tree'; onChange: (view: 'list' | 'tree') => void }) {
  return <Box flexDirection="row" className="asset-review-view-picker" role="group" aria-label="Asset view">
    {(['list', 'tree'] as const).map((option) => <button
      key={option}
      type="button"
      aria-label={option === 'list' ? 'List' : 'Tree'}
      aria-pressed={view === option}
      onClick={() => onChange(option)}
    ><Icon name={option === 'list' ? 'list' : 'sitemap'} size={16} color={theme.colors.gray} /></button>)}
  </Box>;
}
