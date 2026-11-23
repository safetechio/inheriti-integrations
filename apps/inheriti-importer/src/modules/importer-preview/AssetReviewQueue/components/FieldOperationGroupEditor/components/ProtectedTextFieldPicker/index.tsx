import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Box, Button, FilterChip, FormTextInput, Icon, Pressable, Text } from '@main-components';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';
import { sourceFieldDisplayName } from '../../../../source-field-coverage';
import './styles.css';

type Field = { id: string; name: string };

const collapsedCount = 3;
const pageSize = 25;

export function ProtectedTextFieldPicker({
  fields,
  availableFields,
  selectedIds,
  onChange,
}: {
  fields: Field[];
  availableFields: Field[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const theme = useTheme();
  const chooserId = useId();
  const chooserToggle = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [resultPage, setResultPage] = useState(0);
  const [selectedPage, setSelectedPage] = useState<number>();
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const selected = new Set(selectedIds);
  const selectedFields = [...selected].flatMap((id) => fieldsById.get(id) ?? []);
  const remaining = availableFields.filter(({ id }) => !selected.has(id));
  const query = search.trim().toLowerCase();
  const results = open
    ? availableFields.filter(({ name }) =>
        sourceFieldDisplayName(name).toLowerCase().includes(query),
      )
    : [];
  const lastPage = Math.max(0, Math.ceil(results.length / pageSize) - 1);
  const page = Math.min(resultPage, lastPage);
  const lastSelectedPage = Math.max(0, Math.ceil(selectedFields.length / pageSize) - 1);
  const visibleSelectedPage = Math.min(selectedPage ?? 0, lastSelectedPage);
  const visibleSelected =
    selectedPage === undefined
      ? selectedFields.slice(0, collapsedCount)
      : selectedFields.slice(visibleSelectedPage * pageSize, (visibleSelectedPage + 1) * pageSize);

  const toggleChooser = () => {
    setSearch('');
    setResultPage(0);
    setOpen(!open);
  };
  const closeChooser = () => {
    setOpen(false);
    chooserToggle.current?.focus();
  };
  const remove = (id: string) => onChange(selectedIds.filter((selectedId) => selectedId !== id));
  const removeChip = (id: string) => {
    remove(id);
    chooserToggle.current?.focus();
  };

  return (
    <Box
      gap="s"
      onKeyDownCapture={(event: KeyboardEvent) => {
        // React Native Web inputs stop the key event from bubbling.
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeChooser();
        }
      }}
    >
      <Text variant="bodySmall" semibold>
        Fields in protected text
      </Text>
      {selectedFields.length ? (
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="xs">
          {visibleSelected.map(({ id, name }) => (
            <Box
              key={id}
              flexDirection="row"
              alignItems="center"
              maxWidth="100%"
              minHeight={theme.importer.controls.smallHeight}
              paddingHorizontal="s"
              paddingVertical={0}
              gap="xxs"
              borderWidth={1}
              borderRadius="pill"
              borderColor="primary10"
              backgroundColor="primary5"
            >
              <Text
                variant="filterChip"
                color="primary120"
                flexShrink={1}
                style={{ minWidth: 0 }}
                className="asset-source-field-label"
              >
                {sourceFieldDisplayName(name)}
              </Text>
              <Pressable
                onPress={() => removeChip(id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${sourceFieldDisplayName(name)} from protected text`}
                style={{
                  flexShrink: 0,
                  width: theme.spacing.l,
                  height: theme.spacing.l,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: theme.radii.pill,
                }}
                {...keyboardActivation(() => removeChip(id))}
              >
                <Icon name="xmark" type="font-awesome-6" size={12} color="primary" label="" />
              </Pressable>
            </Box>
          ))}
          {selectedPage === undefined && selectedFields.length > collapsedCount ? (
            <Button
              title={`+${selectedFields.length - collapsedCount}`}
              accessibilityLabel={`Show ${selectedFields.length - collapsedCount} more selected fields`}
              size="sm"
              variant="plain"
              onPress={() => setSelectedPage(0)}
            />
          ) : null}
          {selectedPage !== undefined ? (
            <Box flexDirection="row" flexWrap="wrap" gap="xs">
              {visibleSelectedPage > 0 ? (
                <Button
                  title="Previous selected fields"
                  size="sm"
                  variant="plain"
                  onPress={() => setSelectedPage(visibleSelectedPage - 1)}
                />
              ) : null}
              {visibleSelectedPage < lastSelectedPage ? (
                <Button
                  title="Next selected fields"
                  size="sm"
                  variant="plain"
                  onPress={() => setSelectedPage(visibleSelectedPage + 1)}
                />
              ) : null}
              <Button
                title="Show fewer selected fields"
                size="sm"
                variant="plain"
                onPress={() => setSelectedPage(undefined)}
              />
            </Box>
          ) : null}
        </Box>
      ) : (
        <Text variant="bodySmall" color="gray">
          Choose fields for this asset.
        </Text>
      )}
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="xs">
        <Pressable
          ref={chooserToggle}
          onPress={toggleChooser}
          accessibilityRole="button"
          aria-expanded={open}
          aria-controls={open ? chooserId : undefined}
          {...keyboardActivation(toggleChooser)}
        >
          <Box
            minHeight={theme.importer.controls.smallHeight}
            justifyContent="center"
            paddingHorizontal="s"
            borderWidth={1}
            borderColor="gray30"
            borderRadius="s"
          >
            <Text variant="buttonSmall" color="gray">
              {open ? 'Close field chooser' : 'Choose fields'}
            </Text>
          </Box>
        </Pressable>
        <Button
          title="Use remaining fields"
          size="sm"
          variant="plain"
          disabled={!remaining.length}
          onPress={() => onChange([...selected, ...remaining.map(({ id }) => id)])}
        />
      </Box>
      {open ? (
        <Box
          nativeID={chooserId}
          padding="s"
          gap="s"
          borderWidth={1}
          borderColor="primary30"
          borderRadius="s"
          backgroundColor="primary5"
        >
          <FormTextInput
            label="Search fields"
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            style={{
              minHeight: theme.importer.controls.smallHeight,
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: theme.spacing.s,
              marginTop: theme.spacing.xs,
              fontSize: theme.textVariants.bodySmall.fontSize,
            }}
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setResultPage(0);
            }}
          />
          {results.length ? (
            <Box
              flexDirection="row"
              flexWrap="wrap"
              gap="xs"
              className="asset-field-chooser-options"
            >
              {results.slice(page * pageSize, (page + 1) * pageSize).map(({ id, name }) => (
                <FilterChip
                  key={id}
                  selected={selected.has(id)}
                  onPress={() => (selected.has(id) ? remove(id) : onChange([...selectedIds, id]))}
                  accessibilityLabel={`Include ${sourceFieldDisplayName(name)} in protected text`}
                >
                  {sourceFieldDisplayName(name)}
                </FilterChip>
              ))}
            </Box>
          ) : (
            <Text variant="bodySmall" color="gray">
              {availableFields.length
                ? 'No fields match your search.'
                : 'No fields available for this group.'}
            </Text>
          )}
          {lastPage > 0 ? (
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="xs">
              <Text variant="bodySmall" color="gray">
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, results.length)} of{' '}
                {results.length} fields
              </Text>
              <Button
                title="Previous fields"
                size="sm"
                variant="plain"
                disabled={page === 0}
                onPress={() => setResultPage(page - 1)}
              />
              <Button
                title="Next fields"
                size="sm"
                variant="plain"
                disabled={page === lastPage}
                onPress={() => setResultPage(page + 1)}
              />
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
