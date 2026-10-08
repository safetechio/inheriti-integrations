import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const configPath = require.resolve('../apps/inheriti-go/electron-builder.config.cjs');
const builderRequire = createRequire(require.resolve('../apps/inheriti-go/node_modules/electron-builder'));
const { AppInfo } = builderRequire('app-builder-lib/out/appInfo.js');

for (const deployment of ['local', 'dev', 'stg', 'prod']) {
  test(`${deployment} packages use the branded name and logo on macOS and Windows`, () => {
    const previous = process.env.INHERITI_BUILD_DEPLOYMENT;
    process.env.INHERITI_BUILD_DEPLOYMENT = deployment;
    delete require.cache[configPath];
    try {
      const config = require(configPath);
      const name = deployment === 'prod' ? 'Inheriti® Go' : `Inheriti® Go ${deployment.toUpperCase()}`;
      const metadata = { name: 'inheriti-go', version: '0.0.2', productName: config.extraMetadata.productName };
      for (const platform of ['mac', 'win', 'linux']) {
        const info = new AppInfo({ config, metadata }, undefined, config[platform]);
        assert.equal(info.productName, name);
        assert.equal(info.productFilename, platform === 'linux' ? 'inheriti-go' : name);
      }
      const svg = readFileSync(config.icon, 'utf8');
      assert.match(svg, /width="1024" height="1024"/);
      const image = svg.match(/data:image\/png;base64,([^"\s]+)/)[1];
      assert.deepEqual(Buffer.from(image, 'base64'), readFileSync(config.linux.icon));
      assert.equal(config.appId, `com.safetech.inheriti.go.${deployment}`);
      assert.equal(config.artifactName, 'Inheriti-Go-' + deployment + '-${version}-${os}-${arch}.${ext}');
      assert.equal(config.linux.executableName, 'inheriti-go');
    } finally {
      if (previous === undefined) delete process.env.INHERITI_BUILD_DEPLOYMENT;
      else process.env.INHERITI_BUILD_DEPLOYMENT = previous;
      delete require.cache[configPath];
    }
  });
}
