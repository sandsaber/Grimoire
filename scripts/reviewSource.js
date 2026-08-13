const REVIEW_SOURCE_RULES = [
  '@typescript-eslint/no-deprecated:error',
  '@typescript-eslint/no-unsafe-assignment:error',
  '@typescript-eslint/no-unsafe-return:error',
  '@typescript-eslint/no-unsafe-call:error',
  '@typescript-eslint/no-unsafe-member-access:error',
  '@typescript-eslint/no-unsafe-argument:error',
];

// Phase 9 cutover transition files use any-typed legacy stubs.
// These are re-enabled when the transition is fully completed.
const REVIEW_SOURCE_IGNORE_PATTERNS = [
  'src/features/chat/controllers/SelectionController.ts',
  'src/features/inline-edit/ui/InlineEditModal.ts',
  'src/features/settings/GrimoireSettings.ts',
  'src/main.ts',
  'src/providers/*/ui/*SettingsTab.ts',
];

function getReviewSourceEslintArgs() {
  const args = [
    'src/**/*.ts',
    '--max-warnings=0',
  ];

  for (const pattern of REVIEW_SOURCE_IGNORE_PATTERNS) {
    args.push('--ignore-pattern', pattern);
  }

  for (const rule of REVIEW_SOURCE_RULES) {
    args.push('--rule', rule);
  }

  return args;
}

module.exports = {
  REVIEW_SOURCE_RULES,
  REVIEW_SOURCE_IGNORE_PATTERNS,
  getReviewSourceEslintArgs,
};
