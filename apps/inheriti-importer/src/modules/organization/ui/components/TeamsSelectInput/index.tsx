import { useEffect, useId, useRef, useState } from 'react';
import { Box, Button, Checkbox, FormTextInput, IconAction, Skeleton, Text } from '@main-components';
import './styles.css';

interface TeamsSelectInputProps {
  teams: ReadonlyArray<{ id: string; name: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

export function TeamsSelectInput({
  teams, selectedIds, onChange, disabled, loading, error, onRetry,
}: TeamsSelectInputProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const pointerOutside = useRef(false);
  const optionsId = useId();
  const searchId = useId();
  const hasOptions = !loading && !error && teams.length > 0;
  const search = query.trim().toLowerCase();
  const matches = teams.filter((team) => team.name.toLowerCase().includes(search));
  const remove = (id: string) => onChange(selectedIds.filter((selected) => selected !== id));

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open || !hasOptions) return;
    event.preventDefault();
    event.stopPropagation();
    document.getElementById(searchId)?.focus();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const markPointer = (event: PointerEvent) => {
      pointerOutside.current = !root.current?.contains(event.target as Node);
    };
    const closeOutside = (event: MouseEvent) => {
      pointerOutside.current = false;
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const clearPointer = () => { pointerOutside.current = false; };
    document.addEventListener('pointerdown', markPointer, true);
    document.addEventListener('pointercancel', clearPointer);
    document.addEventListener('click', closeOutside);
    return () => {
      document.removeEventListener('pointerdown', markPointer, true);
      document.removeEventListener('pointercancel', clearPointer);
      document.removeEventListener('click', closeOutside);
      clearPointer();
    };
  }, [open]);

  return (
    <Box
      ref={root}
      gap="s"
      onClick={(event: MouseEvent) => event.stopPropagation()}
      onBlur={(event: FocusEvent) => {
        // Keep the layout stable until the outside control receives its click.
        if (!pointerOutside.current && event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={closeOnEscape}
    >
      <FormTextInput
        label="Search teams"
        placeholder="Search teams"
        nativeID={searchId}
        value={query}
        disabled={disabled || !hasOptions}
        onKeyPress={(event: KeyboardEvent) => {
          if (event.key === 'ArrowDown' && !open) setOpen(true);
          closeOnEscape(event);
        }}
        aria-controls={open && hasOptions ? optionsId : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => { if (!disabled) setOpen(true); }}
        onChangeText={(value) => { setQuery(value); setOpen(true); }}
      />

      {loading ? (
        <Box role="status" aria-busy={true} aria-label="Loading teams" gap="xs">
          <Skeleton height={28} />
          <Skeleton height={28} />
        </Box>
      ) : error ? (
        <Box gap="s">
          <Text variant="bodySmall" color="danger120" accessibilityRole="alert">{error}</Text>
          {onRetry ? <Button title="Retry loading teams" variant="outlined" color="gray" size="sm" onPress={onRetry} disabled={disabled} /> : null}
        </Box>
      ) : teams.length === 0 ? (
        <Text variant="bodySmall" color="gray">No teams available for this organisation.</Text>
      ) : open ? (
        <Box
          nativeID={optionsId}
          role="group"
          aria-label="Available teams"
          backgroundColor="white"
          borderColor="gray30"
          borderWidth={1}
          borderRadius="s"
          style={{ maxHeight: 'min(176px, 26vh)', overflowY: 'auto' }}
        >
          {matches.length === 0 ? (
            <Box padding="s"><Text variant="bodySmall" color="gray" accessibilityRole="status">No matching teams.</Text></Box>
          ) : matches.map((team) => {
            const selected = selectedIds.includes(team.id);
            return (
              <label className="teams-select-option" key={team.id}>
                <Text variant="bodySmall">{team.name}</Text>
                <Checkbox aria-label={team.name} checked={selected} disabled={disabled} onChange={() => {
                  if (selected) remove(team.id);
                  else onChange([...selectedIds, team.id]);
                }} />
              </label>
            );
          })}
        </Box>
      ) : null}

      {selectedIds.length > 0 ? (
        <Box role="group" aria-label="Selected teams" flexDirection="row" flexWrap="wrap" gap="s">
          {selectedIds.map((id) => {
            const name = teams.find((team) => team.id === id)?.name ?? id;
            return (
              <Box
                key={id}
                flexDirection="row"
                alignItems="center"
                gap="xs"
                maxWidth="100%"
                borderColor="gray30"
                borderWidth={1}
                borderRadius="s"
                backgroundColor="white"
                style={{ paddingLeft: 8 }}
              >
                <Text variant="bodySmall" semibold style={{ overflowWrap: 'anywhere' }}>{name}</Text>
                <IconAction name="xmark" label={`Remove ${name}`} disabled={disabled} onPress={() => remove(id)} />
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}
