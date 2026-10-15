const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const angular = require('@angular-eslint/eslint-plugin');
const template = require('@angular-eslint/eslint-plugin-template');

module.exports = [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tsParser, parserOptions: { project: './tsconfig.json' } },
    plugins: { '@typescript-eslint': tsPlugin, '@angular-eslint': angular },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@angular-eslint/component-class-suffix': 'error',
      '@angular-eslint/directive-class-suffix': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@angular-eslint/no-empty-lifecycle-method': 'error'
    }
  },
  {
    files: ['src/**/*.html'],
    plugins: { '@angular-eslint/template': template },
    languageOptions: { parser: require('@angular-eslint/template-parser') },
    rules: {
      '@angular-eslint/template/alt-text': 'error',
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/no-duplicate-attributes': 'error',
      '@angular-eslint/template/no-positive-tabindex': 'error'
    }
  }
];
