import tseslint from "typescript-eslint";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**"] },
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      // Frontend TS migration is intentionally loose (tsconfig strict:false)
      // for now — `any` shows up at library/DOM boundaries. Revisit once
      // the codebase is tightened incrementally.
      "@typescript-eslint/no-explicit-any": "off",
    },
    settings: {
      react: { version: "detect" },
    },
  },
  prettierConfig,
);
