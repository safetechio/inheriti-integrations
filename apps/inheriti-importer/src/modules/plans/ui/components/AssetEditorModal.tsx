import {
  getAssetUiExtension,
  getPlanAssetIconName,
  getPlanAssetFieldTestIds,
  type PlanAssetFieldDefinition,
} from '@modules/plans/domain/asset-metadata';
import {
  useAssetEditorConfig,
  useAssetEditorState,
  type AssetEditorModalProps,
} from '@modules/plans/ui/asset-editor';
import {
  Alert,
  Box,
  Icon,
  Pressable,
  Text,
  ScrollView,
  TextInput,
} from '@modules/_shared/ui/components';
import { ModalPortal } from '@modules/_shared/ui/components/Base/Portal';
import { useState } from 'react';
import Button from '@modules/_shared/ui/components/Base/Button';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { PlainTextAssetForm, StandardAssetForm } from '@modules/plans/ui/forms';

interface ImporterAssetEditorModalProps extends AssetEditorModalProps {
  onDismiss: () => void;
}

/** Consumer-owned asset UI. The SDK supplies state/metadata; this shell owns presentation. */
export function AssetEditorModal({
  open,
  type,
  asset,
  limits,
  initialUsage,
  onSave,
  onDismiss,
}: ImporterAssetEditorModalProps) {
  const extension = getAssetUiExtension(type);
  const editor = useAssetEditorState({
    asset,
    type,
    limits,
    initialUsage,
    onSave,
  });

  if (!extension) return null;

  return (
    <ModalPortal visible={open} onRequestClose={onDismiss}>
      <Box flex={1} justifyContent="center" alignItems="center" style={styles.backdrop}>
        <Box width="100%" maxWidth={520} maxHeight="90%" backgroundColor="white" borderRadius="s">
          <Box padding="l" flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" alignItems="center" gap="s">
              <Icon name={getPlanAssetIconName(type)} type="font-awesome-6" color="primary120" />
              <Text variant="heading3">{getAssetTypeDisplayName(type)}</Text>
            </Box>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close asset editor"
              onPress={onDismiss}
              {...keyboardActivation(onDismiss)}
            >
              <Icon name="xmark" type="font-awesome-6" color="gray" />
            </Pressable>
          </Box>

          {!extension.isMedia && type === 'PLAIN-TEXT' ? (
            <Box padding="l">
              <PlainTextAssetForm
                asset={asset}
                assetType={extension.type}
                planType="BACKUP"
                onSubmit={(value) => {
                  onSave(value);
                  onDismiss();
                }}
                onCancel={onDismiss}
              />
            </Box>
          ) : null}

          {!extension.isMedia && type !== 'PLAIN-TEXT' ? (
            <Box padding="l">
              <StandardAssetForm
                asset={asset}
                assetType={extension.type}
                planType="BACKUP"
                onSubmit={(value) => {
                  onSave(value);
                  onDismiss();
                }}
                onCancel={onDismiss}
              />
            </Box>
          ) : null}

          {extension.isMedia ? (
            <ScrollView>
              <Box paddingHorizontal="l" paddingBottom="l" gap="m">
                <AssetField
                  definition={{ id: 'name', source: 'meta.name', inputKind: 'text' }}
                  type={type}
                  value={editor.values.meta.name}
                  onChange={(value) => editor.setValue('meta.name', value)}
                  error={editor.errors['meta.name']}
                />
                {extension.formFields
                  .filter((field) => field.source !== 'meta.name')
                  .map((field) =>
                    field.source === 'secret.data' && extension.isMedia ? (
                      <MediaField
                        key={field.source}
                        type={type}
                        fileName={readValue(editor.values, 'secret.fileName')}
                        error={editor.errors[field.source]}
                        onSelect={async (file) => {
                          editor.setValue('secret.data', file.data);
                          editor.setValue('secret.mimeType', file.mimeType);
                          editor.setValue('secret.fileName', file.fileName);
                          editor.setValue('secret.fileSize', file.size);
                        }}
                      />
                    ) : (
                      <AssetField
                        key={field.source}
                        definition={field}
                        type={type}
                        value={readValue(editor.values, field.source)}
                        onChange={(value) => editor.setValue(field.source, value)}
                        error={editor.errors[field.source]}
                      />
                    ),
                  )}
              </Box>
            </ScrollView>
          ) : null}

          {extension.isMedia ? (
            <Box padding="l" gap="m">
              <Text variant="bodySmall">
                Usage: {Math.round(editor.usage.overallUsage)}% ({editor.usage.metrics.charsLength}{' '}
                characters, {editor.usage.metrics.filesCount} files)
              </Text>
              <Box flexDirection="row" justifyContent="flex-end" gap="s">
                <Button title="Cancel" variant="outlined" color="danger" onPress={onDismiss} />
                <Button
                  title="Save"
                  disabled={!editor.isValid}
                  onPress={() => {
                    editor.save();
                    onDismiss();
                  }}
                />
              </Box>
            </Box>
          ) : null}
        </Box>
      </Box>
    </ModalPortal>
  );
}

function MediaField({
  type,
  fileName: selectedFileName,
  error,
  onSelect,
}: {
  type: string;
  fileName: unknown;
  error?: string;
  onSelect: (file: {
    data: Blob;
    fileName: string;
    mimeType: string;
    size: number;
  }) => Promise<void>;
}) {
  const { selectFile } = useAssetEditorConfig();
  const [loading, setLoading] = useState(false);
  const fileName = typeof selectedFileName === 'string' ? selectedFileName : undefined;

  const pickFile = async () => {
    setLoading(true);
    try {
      const file = await selectFile(
        type === 'IMAGE' ? 'image/*' : type === 'VIDEO' ? 'video/*' : '*/*',
      );
      if (file) await onSelect(file);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box gap="s">
      <Text variant="bodySmall" bold>
        {type} file
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select ${type} file`}
        disabled={loading}
        onPress={pickFile}
        {...(loading ? {} : keyboardActivation(pickFile))}
      >
        <Box padding="m" borderWidth={1} borderColor="gray30" borderRadius="s">
          <Text>{loading ? 'Selecting file…' : (fileName ?? 'Select file')}</Text>
        </Box>
      </Pressable>
      {error ? <Alert>{error}</Alert> : null}
    </Box>
  );
}

function AssetField({
  definition,
  type,
  value,
  onChange,
  error,
}: {
  definition: PlanAssetFieldDefinition;
  type: string;
  value: unknown;
  onChange: (value: string) => void;
  error?: string;
}) {
  const multiline = definition.inputKind === 'textarea' || definition.inputKind === 'word-list';
  const secure = definition.inputKind === 'text' && definition.source.startsWith('secret.');
  const label = definition.source.split('.').at(-1)?.replaceAll('-', ' ') ?? definition.id;

  return (
    <Box gap="s">
      <Text variant="bodySmall" bold>
        {label}
      </Text>
      <TextInput
        testID={getPlanAssetFieldTestIds(type, definition.id).testID}
        accessibilityLabel={label}
        value={typeof value === 'string' ? value : ''}
        onChangeText={onChange}
        multiline={multiline}
        secureTextEntry={secure}
        numberOfLines={multiline ? 4 : 1}
        placeholder={label}
        style={styles.input}
      />
      {error ? <Alert>{error}</Alert> : null}
    </Box>
  );
}

function readValue(
  values: { meta: Record<string, unknown>; secret: Record<string, unknown> },
  source: string,
): unknown {
  const [scope, ...parts] = source.split('.');
  if (scope !== 'meta' && scope !== 'secret') return undefined;
  return parts.reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, values[scope]);
}

const styles = {
  backdrop: {
    backgroundColor: 'rgba(59, 28, 97, 0.95)',
    padding: 24,
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 9999,
  },
  input: {
    borderColor: '#d7d2df',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
} as const;

export default AssetEditorModal;
