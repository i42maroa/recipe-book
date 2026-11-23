const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

test('Vercel discovers a Node configuration and both emitted API entries load as CommonJS', () => {
  const root = path.resolve(__dirname, '..');
  // Vercel locates tsconfig.json starting at the API entry's directory.
  const filename = ts.findConfigFile(path.join(root, 'api'), ts.sys.fileExists);
  const config = ts.readConfigFile(filename, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(filename));
  assert.deepEqual(parsed.errors, []);
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
