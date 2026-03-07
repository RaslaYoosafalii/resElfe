import js from '@eslint/js';
import globals from 'globals';

export default [

  {
    ignores: [
      'node_modules/**',
      'public/**',
      'uploads/**'
    ]
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    },

    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
      'indent': ['error', 2],
      'no-undef': 'error'
    }
  }
];