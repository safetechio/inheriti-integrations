import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const target = path.resolve(process.argv[2] ?? 'apps/inheriti-ide');
const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
const sourceRoot = path.join(target, 'src');

const forbiddenSource = [
  ['create', 'Webview', 'Panel'].join(''),
  ['register', 'Webview', 'ViewProvider'].join(''),
  ['register', 'CustomEditorProvider'].join(''),
  ['create', 'FileSystemWatcher'].join(''),
  ['workspace', '.', 'findFiles'].join(''),
  ['execute', 'DocumentSymbolProvider'].join(''),
];
const forbiddenDependencies = ['electron', 'playwright', 'puppeteer'];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(absolute) : Promise.resolve(entry.name.endsWith('.ts') ? [absolute] : []);
    }),
  );
  return nested.flat();
}

for (const file of await sourceFiles(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  for (const token of forbiddenSource) {
    if (source.includes(token)) throw new Error(`Forbidden VS Code API ${token} in ${path.relative(target, file)}`);
  }
}

if ('browser' in manifest) throw new Error('Desktop extension must not expose a browser entrypoint');
if (manifest.contributes?.customEditors !== undefined) throw new Error('Custom editor contributions are forbidden');
if (manifest.contributes?.viewsWelcome?.some((item) => /<[^>]+>/.test(item.contents))) {
  throw new Error('HTML view content is forbidden');
}

const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
for (const dependency of forbiddenDependencies) {
  if (dependency in dependencies) throw new Error(`Forbidden embedded-browser dependency: ${dependency}`);
}

console.log('vscode-native-security-boundaries-ok');
