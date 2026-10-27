// Validate an eas.json with @expo/eas-json (same code path eas-cli uses).
const path = require('path');
const fs = require('fs');
const [toolsDir, easJsonPath] = process.argv.slice(2);
const { EasJsonAccessor, EasJsonUtils, Platform } = require(path.join(toolsDir, 'node_modules/@expo/eas-json'));

async function check(label, raw) {
  console.log(`== ${label}`);
  try {
    const acc = EasJsonAccessor.fromRawString(raw);
    const cli = await EasJsonUtils.getCliConfigAsync(acc);
    console.log('cli:', JSON.stringify(cli));
    for (const name of await EasJsonUtils.getBuildProfileNamesAsync(acc)) {
      for (const p of [Platform.ANDROID, Platform.IOS]) {
        const prof = await EasJsonUtils.getBuildProfileAsync(acc, p, name);
        const warn = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(acc, p, name);
        const pick = (({ channel, distribution, developmentClient, autoIncrement, env }) => ({ channel, distribution, developmentClient, autoIncrement, env }))(prof);
        console.log(`build.${name}.${p}:`, JSON.stringify(pick), warn.length ? 'WARN ' + JSON.stringify(warn) : '');
      }
    }
    for (const name of await EasJsonUtils.getSubmitProfileNamesAsync(acc)) {
      for (const p of [Platform.ANDROID, Platform.IOS]) {
        const prof = await EasJsonUtils.getSubmitProfileAsync(acc, p, name);
        console.log(`submit.${name}.${p}:`, JSON.stringify(prof));
      }
    }
    console.log('RESULT: valid');
  } catch (e) {
    console.log('RESULT: invalid ->', e.message);
  }
}

(async () => {
  const raw = fs.readFileSync(easJsonPath, 'utf8');
  await check('doc eas.json', raw);
  const j = JSON.parse(raw);
  j.build.production.autoIncrement = 'yes-please';
  await check('negative control: autoIncrement = "yes-please"', JSON.stringify(j));
  const k = JSON.parse(raw);
  k.cli.appVersionSource = 'cloud';
  await check('negative control: appVersionSource = "cloud"', JSON.stringify(k));
})();
