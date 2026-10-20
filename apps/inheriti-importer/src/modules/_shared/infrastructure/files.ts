import { type OpenedVaultFile } from '@modules/import/domain/vault';

export async function filesFromList(fileList: FileList | File[]): Promise<OpenedVaultFile[]> {
  const files = Array.from(fileList);
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      data: await file.arrayBuffer(),
    })),
  );
}

export async function openVaultFiles(): Promise<OpenedVaultFile[]> {
  if (window.inheriti?.openFiles) {
    const native = await window.inheriti.openFiles();
    return native.map((file) => ({
      name: file.name,
      path: file.path,
      data: Uint8Array.from(file.data).buffer,
    }));
  }

  return pickWithInput();
}

function pickWithInput(): Promise<OpenedVaultFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.kdbx,.1pux,.json,.csv,.yaml,.yml,.env,application/json,text/csv,text/yaml';
    input.addEventListener('change', async () => {
      if (!input.files?.length) {
        resolve([]);
        return;
      }
      resolve(await filesFromList(input.files));
    });
    input.click();
  });
}
