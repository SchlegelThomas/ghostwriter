import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["node_modules/", "**/dist/**", "**/.expo/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended
];
