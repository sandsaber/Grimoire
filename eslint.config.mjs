import jestPlugin from 'eslint-plugin-jest';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { DEFAULT_ACRONYMS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import { defineConfig } from 'eslint/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const jestRecommended = jestPlugin.configs['flat/recommended'];
const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

const projectObsidianRuleOverrides = {
  'obsidianmd/ui/sentence-case': [
    'error',
    {
      ignoreWords: ['Grimoire', 'Codex', 'OpenCode', 'MiMoCode', 'Mimocode', 'Kimi Code', 'WSL'],
      brands: [...DEFAULT_BRANDS, 'Grimoire', 'Codex', 'OpenCode', 'MiMoCode', 'Mimocode', 'Kimi Code'],
      acronyms: [...DEFAULT_ACRONYMS, 'TOML', 'WSL'],
      ignoreRegex: ['\\.(?:claude|codex|opencode|mimocode|kimicode)/'],
      enforceCamelCaseLower: true,
    },
  ],
};

export default defineConfig([
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'main.js'],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['esbuild.config.mjs', 'scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        module: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  {
    // Phase 9 cutover transition files use any-typed legacy stubs.
    // These rules are re-enabled when the legacy code is fully deleted.
    files: [
      'src/features/chat/controllers/SelectionController.ts',
      'src/features/inline-edit/ui/InlineEditModal.ts',
      'src/features/settings/GrimoireSettings.ts',
      'src/main.ts',
      'src/providers/*/ui/*SettingsTab.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      ...projectObsidianRuleOverrides,
      'no-console': 'error',
    },
  },
  {
    files: [
      'src/providers/*/runtime/**/*.ts',
      'src/providers/*/storage/**/*.ts',
      'src/providers/*/history/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(?:^|/)ui(?:/|$)',
              message: 'Provider runtime, storage, and history modules must not import UI modules.',
            },
            {
              regex: '(?:^|/)GrimoireView(?:/|$)',
              message: 'Provider runtime, storage, and history modules must not import the chat view.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?:(?:@/)?(?:features|shared|ui|GrimoireView)|\\.{1,2}/(?:[^/]+/)*(?:features|shared|ui|GrimoireView))(?:/|$)',
              message: 'Core modules must not import feature or shared UI modules.',
            },
            {
              regex: '(?:^|/)providers/(?:claude|codex|opencode|grok|mimocode|kimicode|antigravity|gemini|qwen|acp)(?:/|$)',
              message: 'Core modules must stay provider-neutral. Route through ProviderRegistry.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    ...jestRecommended,
    rules: {
      ...jestRecommended.rules,
      'eslint-comments/no-restricted-disable': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // Test fixtures intentionally exercise legacy APIs, raw DOM behavior, and
      // Obsidian path/type edge cases. Keep these production-only constraints on
      // src/** while retaining the general TypeScript and Jest checks for tests.
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      'eslint-comments/require-description': 'off',
      '@microsoft/sdl/no-inner-html': 'off',
      'obsidianmd/hardcoded-config-path': 'off',
      'obsidianmd/no-static-styles-assignment': 'off',
      'obsidianmd/no-tfile-tfolder-cast': 'off',
      'obsidianmd/no-global-this': 'off',
      'obsidianmd/prefer-create-el': 'off',
      'obsidianmd/prefer-window-timers': 'off',
      'obsidianmd/ui/sentence-case': 'off',
    },
  },
]);
