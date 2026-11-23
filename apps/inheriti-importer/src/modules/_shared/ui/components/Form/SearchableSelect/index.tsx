import { useEffect, useRef, useState } from 'react';
import { Icon } from '@modules/_shared/ui/components/Base/Icon';
import { Box, Text } from '@modules/_shared/ui/components/Primitives';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';
import type { FormSelectProps } from '../Select';
import { useSearchableSelect } from './hooks/use-searchable-select';
import './styles.css';

export function FormSearchableSelect(
  props: FormSelectProps & {
    autoFocus?: boolean;
    placeholder?: string;
    searchPlaceholder?: string;
    noMatchesText?: string;
  },
) {
  const {
    label,
    value,
    options,
    disabled,
    helperText,
    autoFocus,
    placeholder = 'Choose a folder',
    searchPlaceholder = 'Search folders',
    noMatchesText = 'No matching folders.',
  } = props;
  const {
    root,
    fieldId,
    query,
    open,
    matches,
    activeIndex,
    activeId,
    optionId,
    onBlur,
    searchFor,
    choose,
    onKeyDown,
  } = useSearchableSelect(props, autoFocus);
  const theme = useTheme();
  const field = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const active = !disabled && (focused || hovered);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? '';
  const listId = `${fieldId}-list`;
  const helperId = `${fieldId}-hint`;

  useEffect(() => {
    if (!open && focused) field.current?.select();
  }, [open, focused]);

  return (
    <Box ref={root} gap="xs">
      <label htmlFor={fieldId}>
        <Text variant="bodySmall" semibold>
          {label}
        </Text>
      </label>
      <Box position="relative">
        <input
          ref={field}
          id={fieldId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-describedby={helperText ? helperId : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          spellCheck={false}
          disabled={disabled}
          placeholder={open ? searchPlaceholder : placeholder}
          value={open ? (query ?? '') : selectedLabel}
          onClick={() => {
            if (!open) searchFor('');
          }}
          onChange={(event) => searchFor(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur();
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            boxSizing: 'border-box',
            width: '100%',
            minHeight: theme.importer.controls.defaultHeight,
            padding: theme.importer.spacing.sectionGap,
            paddingRight: theme.spacing.xxl,
            border: `1px solid ${active ? theme.colors.primary : theme.colors.gray30}`,
            borderRadius: theme.importer.borders.controlRadius,
            backgroundColor: disabled
              ? theme.colors.gray5
              : active
                ? theme.colors.primary5
                : theme.colors.white,
            opacity: disabled ? 0.65 : 1,
            color: theme.colors.gray120,
            fontFamily: theme.textVariants.bodyRegular.fontFamily,
            fontSize: theme.textVariants.bodyRegular.fontSize,
            textOverflow: 'ellipsis',
            outline: 'none',
            boxShadow: focused && !disabled ? `0 0 0 3px ${theme.colors.primary10}` : undefined,
            transition: 'border-color 150ms, background-color 150ms, box-shadow 150ms',
            cursor: disabled ? 'not-allowed' : open ? 'text' : 'pointer',
          }}
        />
        <Box
          aria-hidden={true}
          position="absolute"
          right={theme.importer.spacing.sectionGap}
          top={0}
          bottom={0}
          justifyContent="center"
          style={{ pointerEvents: 'none' }}
        >
          <Icon
            name={open ? 'magnifying-glass' : 'chevron-down'}
            size={12}
            color={theme.colors.gray120}
          />
        </Box>
      </Box>
      {open ? (
        <Box backgroundColor="white" borderColor="gray30" borderWidth={1} borderRadius="s">
          <Box
            nativeID={listId}
            role="listbox"
            aria-label={label}
            style={{ maxHeight: 'min(176px, 26vh)', overflowY: 'auto' }}
          >
            {matches.map((option, index) => (
              <Box
                key={option.value}
                nativeID={optionId(index)}
                role="option"
                aria-selected={option.value === value}
                className="form-searchable-select-option"
                backgroundColor={
                  index === activeIndex
                    ? 'primary10'
                    : option.value === value
                      ? 'primary5'
                      : undefined
                }
                padding="s"
                onMouseDown={(event: MouseEvent) => event.preventDefault()}
                onClick={() => choose(option.value)}
              >
                <Text
                  variant="bodySmall"
                  semibold={option.value === value}
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {option.label}
                </Text>
              </Box>
            ))}
          </Box>
          {matches.length === 0 ? (
            <Box padding="s">
              <Text variant="bodySmall" color="gray" accessibilityRole="status">
                {noMatchesText}
              </Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
      {helperText ? (
        <Text nativeID={helperId} variant="bodySmall" color="gray">
          {helperText}
        </Text>
      ) : null}
    </Box>
  );
}
