const REVIEW_SOURCE_RULES = [
  '@typescript-eslint/no-deprecated:error',
  '@typescript-eslint/no-explicit-any:error',
  '@typescript-eslint/no-unsafe-assignment:error',
  '@typescript-eslint/no-unsafe-return:error',
  '@typescript-eslint/no-unsafe-call:error',
  '@typescript-eslint/no-unsafe-member-access:error',
  '@typescript-eslint/no-unsafe-argument:error',
];

function getReviewSourceEslintArgs() {
  const args = [
    'src/**/*.ts',
    '--max-warnings=0',
  ];

  for (const rule of REVIEW_SOURCE_RULES) {
    args.push('--rule', rule);
  }

  return args;
}

module.exports = {
  REVIEW_SOURCE_RULES,
  getReviewSourceEslintArgs,
};
