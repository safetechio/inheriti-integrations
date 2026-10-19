import { extname } from 'node:path';
import { chooseSaveInheritiFile, saveProtectedFile } from '@safetech/inheriti-elements-core/node-base';

export async function chooseProtectedFile(): Promise<string> {
  const path = await chooseSaveInheritiFile();
  if (extname(path).toLowerCase() !== '.inheriti') throw new Error('viewer_file_invalid');
  return path;
}

export { saveProtectedFile };
