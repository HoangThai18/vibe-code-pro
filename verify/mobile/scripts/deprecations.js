// Report TS suggestion diagnostics flagged as deprecated (reportsDeprecated) for project files.
const path = require('path');
const root = process.argv[2];
const ts = require(path.join(root, 'node_modules/typescript'));
const cfgPath = path.join(root, 'tsconfig.json');
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const files = cfg.fileNames;
const host = {
  getScriptFileNames: () => files,
  getScriptVersion: () => '1',
  getScriptSnapshot: (f) => (ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)) : undefined),
  getCurrentDirectory: () => root,
  getCompilationSettings: () => cfg.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
};
const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
let n = 0;
for (const f of files) {
  for (const d of ls.getSuggestionDiagnostics(f)) {
    if (!d.reportsDeprecated) continue;
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    console.log(`${path.relative(root, f)}:${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    n++;
  }
}
console.log(`deprecated usages: ${n} in ${files.length} files`);
