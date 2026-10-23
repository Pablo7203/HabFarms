import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { "react-hooks/incompatible-library": "off" } },
  { files: ["scripts/**/*.mjs"], rules: { "@typescript-eslint/no-unused-vars": "off" } },
  { files: ["desktop-proof/**/*.cjs", "apps/desktop/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  { files: ["apps/desktop/src/**/*.tsx"], rules: { "@next/next/no-img-element": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "supabase/.branches/**",
    "supabase/.temp/**",
    "desktop-proof/**/dist/**",
    "desktop-proof/**/target/**",
    "desktop-proof/**/node_modules/**",
    "desktop-proof/**/src-tauri/gen/**",
    "apps/desktop/dist/**",
    "apps/desktop/node_modules/**",
    "apps/desktop/src-tauri/target/**",
    "apps/desktop/src-tauri/local-core/target/**",
    "apps/desktop/src-tauri/gen/**",
    "apps/desktop/.local/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
