// Extract ```ts/```tsx blocks whose first line is `// <path>` and the eas.json block, verbatim.
const fs = require('fs');
const path = require('path');
const [docsDir, outDir] = process.argv.slice(2);
const docs = ['app-data.md', 'platform-features.md', 'testing.md', 'release.md'];
const manifest = [];
for (const doc of docs) {
  const lines = fs.readFileSync(path.join(docsDir, doc), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^```(\w+)\s*$/);
    if (!m) continue;
    const lang = m[1];
    let j = i + 1;
    while (j < lines.length && lines[j] !== '```') j++;
    const body = lines.slice(i + 1, j);
    let target = null;
    if ((lang === 'ts' || lang === 'tsx') && /^\/\/ \S+\.(ts|tsx)\s*$/.test(body[0])) target = body[0].slice(3).trim();
    if (lang === 'json' && doc === 'release.md' && body.join('\n').includes('"appVersionSource"')) target = 'eas.json';
    if (lang === 'yaml' && /^# \S+\.ya?ml/.test(body[0])) target = body[0].slice(2).trim();
    if (target) {
      const dest = path.join(outDir, target);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body.join('\n') + '\n');
      manifest.push(`${doc}:${i + 2}-${j} -> ${target} (${lang})`);
    } else {
      manifest.push(`${doc}:${i + 2}-${j} SKIPPED (${lang}) first line: ${body[0]}`);
    }
    i = j;
  }
}
console.log(manifest.join('\n'));
