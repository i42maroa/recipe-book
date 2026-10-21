const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

exports.loadService = (file, injections, globals = {}, modules = {}) => {
  const tokens = Object.fromEntries(Object.keys(injections).map((name) => [name, name]));
  const signal = (initial) => {
    let value = initial;
    const read = () => value;
    read.set = (next) => { value = next; };
    read.update = (change) => { value = change(value); };
    read.asReadonly = () => read;
    return read;
  };
  const core = { ...tokens, Injectable: () => (value) => value, signal, computed: (read) => read, effect: (run) => run(), inject: (token) => injections[token] };
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: module.exports, module, setTimeout, clearTimeout, structuredClone, AbortController, Error,
    require: (name) => modules[name] ?? (name === '@angular/core' ? core : name === 'rxjs' ? require('rxjs') : tokens),
    ...globals,
  });
  return module.exports;
};

exports.memoryStorage = () => {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
};
