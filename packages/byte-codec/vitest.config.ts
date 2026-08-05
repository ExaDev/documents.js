import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    projects: [
      {
        name: 'unit',
        test: {
          dir: 'src',
          include: ['**/*.test.ts'],
        },
      },
    ],
  },
});
