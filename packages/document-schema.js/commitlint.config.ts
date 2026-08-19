import { commitTypes } from './release.config';

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', commitTypes.map((t) => t.type)],
  },
  // dependabot-auto-merge.yml lands Dependabot's rebase-merged commits on main verbatim, including its generated Bumps/Release notes/Changelog body, which routinely contains a markdown link line over the inherited body-max-line-length limit and cannot be reformatted by this repo. Skip linting entirely for those commits, identified by the "Signed-off-by: dependabot[bot]" trailer that fetch-metadata's auto-merge always appends, while leaving every rule fully enforced for human-authored commits.
  ignores: [(message: string) => /^Signed-off-by: dependabot\[bot\]/m.test(message)],
};
