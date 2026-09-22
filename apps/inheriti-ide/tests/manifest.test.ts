import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface ExtensionManifest {
  readonly private?: boolean;
  readonly browser?: string;
  readonly extensionKind?: readonly string[];
  readonly activationEvents?: readonly string[];
  readonly contributes?: {
    readonly commands?: readonly { readonly command: string }[];
    readonly customEditors?: unknown;
    readonly views?: Readonly<Record<string, readonly { readonly id: string }[]>>;
    readonly viewsContainers?: { readonly activitybar?: readonly { readonly id: string }[] };
  };
}

describe('VS Code extension manifest', () => {
  it('contributes native desktop surfaces and remains non-publishable', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as ExtensionManifest;

    expect(manifest.private).toBe(true);
    expect(manifest.extensionKind).toEqual(['ui']);
    expect(manifest.activationEvents).toContain('onCommand:inheritiElements.selectOrganization');
    expect(manifest.browser).toBeUndefined();
    expect(manifest.contributes?.customEditors).toBeUndefined();
    expect(manifest.contributes?.viewsContainers?.activitybar?.[0]?.id).toBe('inheritiElements');
    expect(manifest.contributes?.views?.inheritiElements?.[0]?.id).toBe('inheritiElements.plans');
    expect(manifest.contributes?.commands?.map(({ command }) => command)).toEqual([
      'inheritiElements.signIn',
      'inheritiElements.signOut',
      'inheritiElements.refresh',
      'inheritiElements.selectOrganization',
      'inheritiElements.openPlan',
      'inheritiElements.revealPlan',
      'inheritiElements.insertField',
      'inheritiElements.downloadAsset',
      'inheritiElements.abortPlanAccess',
      'inheritiElements.importConfiguration',
      'inheritiElements.forgetMasterKey',
    ]);
    // The extension contributes no HTML surface of any kind: no webview, no custom editor, no browser entry.
    expect(manifest.browser).toBeUndefined();
    expect(manifest.contributes?.customEditors).toBeUndefined();
  });
});
