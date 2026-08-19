import type { Configuration } from 'lint-staged';

const config: Configuration = {
  '*.{ts,tsx}': 'eslint --fix',
};

export default config;
