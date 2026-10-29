const path = require('node:path');
const fsSync = require('node:fs');

function assignEnvironment(values, overrideExisting = false) {
  for (const [key, value] of Object.entries(values)) {
    if (key === 'environment') {
      process.env.INHERITI_ENV = String(value);
      continue;
    }
    if (!overrideExisting && key in process.env) continue;
    process.env[key] = String(value);
  }
}

// Load packaged or local environment values before main-process modules read them.
function loadEnvironment({ isPackaged, electronDir }) {
  if (isPackaged) {
    const runtimePath = path.join(electronDir, '../dist/runtime-environment.json');
    assignEnvironment(JSON.parse(fsSync.readFileSync(runtimePath, 'utf8')), true);
    return;
  }

  const environment = process.env.INHERITI_ENV || 'local';
  const envPath = path.join(electronDir, `../.env.${environment}`);
  try {
    const contents = fsSync.readFileSync(envPath, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('Unable to load environment', error);
  }
}

module.exports = { loadEnvironment };
