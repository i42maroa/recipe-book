const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

function vercelConfig() {
  const root = path.resolve(__dirname, '..');
  // Vercel locates tsconfig.json starting at the API entry's directory.
  const filename = ts.findConfigFile(path.join(root, 'api'), ts.sys.fileExists);
  const config = ts.readConfigFile(filename, ts.sys.readFile);
  assert.equal(config.error, undefined);
  // @vercel/node applies fixConfig BEFORE resolving `extends`. Its fallback
  // sets strict=false whenever `module` is absent in the raw entry config.
  // Reading only TypeScript's merged config would miss this deployment bug.
  config.config.compilerOptions ??= {};
  config.config.compilerOptions.target ??= 'ES2021';
  config.config.compilerOptions.esModuleInterop ??= true;
  if (config.config.compilerOptions.module === undefined) {
    Object.assign(config.config.compilerOptions, { module: 'NodeNext', moduleResolution: 'NodeNext', strict: false });
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(filename));
  assert.deepEqual(parsed.errors, []);
  return { root, parsed };
}

test('Vercel preprocessing preserves null checks and type-checks both MCP API entries', () => {
  const { parsed } = vercelConfig();
  assert.equal(parsed.options.strict, true);
  assert.equal(ts.getStrictOptionValue(parsed.options, 'strictNullChecks'), true);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: filename => filename,
    getNewLine: () => ts.sys.newLine,
  }));
});

test('Vercel discovers a Node configuration and both emitted API entries load as CommonJS', () => {
  const { root, parsed } = vercelConfig();
  for (const name of ['mcp', 'mcp-metadata']) {
    const entry = path.join(root, 'api', `${name}.ts`);
    const source = ts.transpileModule(fs.readFileSync(entry, 'utf8'), { compilerOptions: parsed.options, fileName: entry }).outputText;
    const output = path.join(root, 'out-tsc/mcp/api', `${name}.js`);
    // Force the CJS loader used by Vercel. Node's module auto-detection would
    // otherwise hide the deployment failure caused by preserved `export`.
    const compiled = new Module(output, module);
    compiled.filename = output;
    compiled.paths = Module._nodeModulePaths(path.dirname(output));
    compiled._compile(source, output);
    assert.equal(typeof compiled.exports.default, 'function');
  }
});
