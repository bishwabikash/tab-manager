// Keeps the Firefox package to the same files the Chrome zip ships.
// tests/crossbrowser.test.js asserts the two packages stay identical.
const dirs = ['.github', 'docs', 'store-assets', 'tests', 'dist', 'node_modules'];

export default {
  ignoreFiles: [
    ...dirs,
    ...dirs.map((d) => `${d}/**`),
    '*.md',
    'description.txt',
    '*.code-workspace',
    'package.json',
    'package-lock.json',
    'web-ext-config.mjs',
    'release-please-config.json',
    '.release-please-manifest.json',
  ],
};
