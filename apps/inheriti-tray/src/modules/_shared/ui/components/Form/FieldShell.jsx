import { Box } from '../Box.jsx';
import { Text } from '../Text.jsx';

export function FieldShell({ id, label, error, children }) {
  return <Box className="field">
    <Text as="label" variant="labelSmall" htmlFor={id}>{label}</Text>
    {children}
    {error && <Text as="span" className="error" id={`${id}-error`} role="alert">{error}</Text>}
  </Box>;
}
