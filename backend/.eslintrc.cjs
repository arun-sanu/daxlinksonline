module.exports = {
  env: {
    node: true,
    es2021: true
  },
  extends: ['eslint:recommended', 'plugin:node/recommended'],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module'
  },
  settings: {
    node: {
      version: '>=18.0.0'
    }
  },
  rules: {
    'no-console': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    'node/no-unsupported-features/es-syntax': 'off',
    'node/no-unsupported-features/node-builtins': 'off',
    'node/no-missing-import': 'off',
    'no-process-exit': 'off',
    'no-empty': 'off',
    'no-dupe-keys': 'off',
    'no-useless-escape': 'off'
  }
};
