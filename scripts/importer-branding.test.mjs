import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../apps/inheriti-importer');
const go = resolve(root, '../inheriti-go');
const configPath = resolve(root, 'electron-builder.config.cjs');
const builderRequire = createRequire(require.resolve('../apps/inheriti-importer/node_modules/electron-builder'));
const { AppInfo } = builderRequire('app-builder-lib/out/appInfo.js');

for (const environment of ['local', 'dev', 'stg', 'prod']) {
  const suffix = environment === 'prod' ? '' : `-${environment}`;
  const name = `Inheriti® Importer${environment === 'prod' ? '' : ` ${environment.toUpperCase()}`}`;
  const png = resolve(root, `public/favicon${suffix}.png`);
  const svg = resolve(root, `public/icon${suffix}.svg`);

  test(`${environment} uses exactly the GO icons`, () => {
    assert.deepEqual(readFileSync(png), readFileSync(resolve(go, environment === 'prod' ? 'src/tray.png' : `build/tray${suffix}.png`)));
    assert.deepEqual(readFileSync(svg), readFileSync(resolve(go, `build/icon${suffix}.svg`)));
  });

  test(`${environment} window keeps its branded title and environment icon`, () => {
    let options;
    const events = {};
    const win = {
      webContents: { id: 1, on: (event, callback) => { events[event] = callback; }, once() {}, setWindowOpenHandler() {} },
      loadFile() {}, loadURL() {}, setTitle(title) { assert.equal(title, options.title); },
    };
    for (const isPackaged of [false, true]) {
      const electron = {
        app: { isPackaged, getVersion: () => '0.1.14' },
        BrowserWindow: function (value) { options = value; return win; },
        session: { defaultSession: { webRequest: { onHeadersReceived() {} }, setPermissionRequestHandler() {} } },
      };
      const module = { exports: {} };
      runInNewContext(readFileSync(resolve(root, 'electron/lib/window.cjs'), 'utf8'), {
        URL, module, process: { env: { INHERITI_ENV: environment } },
        require: (id) => id === 'electron' ? electron : id === './ipc-guard.cjs' ? { trustedWebContentsIds: new Set() } : require(id),
      });
      module.exports.createWindow(resolve(root, 'electron'));
      assert.equal(options.title, `${name} · v0.1.14`);
      assert.equal(options.icon, isPackaged ? resolve(root, `dist/favicon${suffix}.png`) : png);
      let prevented = false;
      events['page-title-updated']({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    }
  });

  if (environment === 'local') continue;
  test(`${environment} packages retain the registered mark on every platform`, () => {
    const previous = process.env.INHERITI_RELEASE_ENV;
    process.env.INHERITI_RELEASE_ENV = environment;
    delete require.cache[configPath];
    try {
      const config = require(configPath);
      const metadata = { ...require(resolve(root, 'package.json')), ...config.extraMetadata };
      for (const platform of ['mac', 'win', 'linux']) {
        assert.equal(new AppInfo({ config, metadata }, undefined, config[platform]).productName, name);
      }
      assert.equal(
        new AppInfo({ config, metadata }, undefined, config.linux).productFilename,
        `inheriti-importer${environment === 'prod' ? '' : `-${environment}`}`,
      );
      assert.equal(config.icon, svg);
      assert.equal(config.linux.icon, png);
      assert.equal(config.appId, `io.safetech.inheriti.importer${environment === 'prod' ? '' : `.${environment}`}`);
    } finally {
      if (previous === undefined) delete process.env.INHERITI_RELEASE_ENV;
      else process.env.INHERITI_RELEASE_ENV = previous;
      delete require.cache[configPath];
    }
  });
}
