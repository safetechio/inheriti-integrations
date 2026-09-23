import { access, readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const target = resolve(process.cwd(), process.argv[2] ?? '.');
const workspace = resolve(import.meta.dirname, '..');
const relativeTarget = relative(workspace, target).split(sep).join('/');
const appNames = ['inheriti-cli', 'inheriti-guard', 'inheriti-ide', 'inheriti-mcp', 'inheriti-tray'];
const errors = [];

try {
  await access(resolve(workspace, 'apps/developer-portal'));
  errors.push('apps/developer-portal: developer portal must remain a sibling repository under elements/');
} catch {
  // Expected: the developer portal is deliberately outside this workspace.
}

for (const file of await sourceFiles(target)) {
  const content = await readFile(file, 'utf8');
  const normalizedFile = relative(workspace, file).split(sep).join('/');

  if (/inheriti-client-sdk\/(?:src|dist)(?:\/|['"])/.test(content)) {
    errors.push(`${normalizedFile}: import the public @safetech/inheriti-client-sdk package export, not source/dist`);
  }

  if (relativeTarget.startsWith('apps/')) {
    const ownApp = relativeTarget.split('/')[1];
    for (const appName of appNames) {
      if (appName !== ownApp && (content.includes(`/apps/${appName}`) || content.includes(`/${appName}/src`))) {
        errors.push(`${normalizedFile}: application-to-application import of ${appName}`);
      }
    }
  }

  if (relativeTarget.startsWith('packages/') && /(?:from|import\s*)\s*['"][^'"]*apps\//.test(content)) {
    errors.push(`${normalizedFile}: package imports an application`);
  }

  if (!relativeTarget.startsWith('packages/test-kit') && !normalizedFile.includes('/tests/')
      && content.includes('@safetech/inheriti-elements-test-kit')) {
    errors.push(`${normalizedFile}: test-kit is forbidden from production source`);
  }

  if (relativeTarget === 'packages/core' && /(?:from|import\s*)\s*['"](?:react|ink|vscode|chrome|@nestjs|keycloak|[^'"]*apps\/)/.test(content)) {
    errors.push(`${normalizedFile}: core must remain host and provider neutral`);
  }

}

// `dependencies` only. A test-kit devDependency ships in nothing — apps package their own `dist` —
// and the source rule above already refuses any non-test file that imports it, which is the property
// that actually matters. Forbidding it outright meant a host's own tests could not drive the host
// against a shared fixture, and that is exactly where a composition gap hides.
for (const manifest of ['packages/core/package.json', 'packages/brand/package.json', 'apps/inheriti-cli/package.json', 'apps/inheriti-guard/package.json', 'apps/inheriti-ide/package.json', 'apps/inheriti-tray/package.json']) {
  const value = JSON.parse(await readFile(resolve(workspace, manifest), 'utf8'));
  if (Object.keys(value.dependencies ?? {}).includes('@safetech/inheriti-elements-test-kit')) {
    errors.push(`${manifest}: production manifest depends on test-kit`);
  }
}

if (errors.length > 0) {
  throw new Error(`Workspace boundary violations:\n${errors.join('\n')}`);
}

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory)) {
    if (['node_modules', 'dist', 'coverage', 'artifacts', '.git'].includes(entry)) continue;
    const path = resolve(directory, entry);
    const info = await stat(path);
    if (info.isDirectory()) result.push(...await sourceFiles(path));
    else if (/\.(?:ts|tsx|mts|cts)$/.test(entry)) result.push(path);
  }
  return result;
}
