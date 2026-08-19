import { commitTypes } from './release.config';

export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(commit: string) => commit.includes('Signed-off-by: dependabot[bot]')],
  rules: {
    'type-enum': [2, 'always', commitTypes.map((t) => t.type)],
  },
};
