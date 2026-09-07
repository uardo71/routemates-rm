import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output anywhere (e.g. inside agent worktrees) + the agent scratch/worktrees dir, which
    // is gitignored but not otherwise excluded from linting.
    "**/.next/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
