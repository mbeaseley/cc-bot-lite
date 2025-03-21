import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    ignores: ['build/**', 'node_modules/**', 'src/generated/**', '**/*.js']
  },
  {
    rules: {
      '@typescript-eslint/no-namespace': 'off'
    }
  }
);
