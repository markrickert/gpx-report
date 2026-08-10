import tseslint from "typescript-eslint";
import globals from "globals";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Backend TS migration is intentionally loose (tsconfig strict:false)
      // for now — `any` shows up at library/mock boundaries. Revisit once
      // the codebase is tightened incrementally.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettierConfig,
);
