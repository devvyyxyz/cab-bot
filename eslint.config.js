// eslint.config.js — ESLint v9+ flat config
module.exports = [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        module: "readonly",
        require: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
        encodeURIComponent: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-console": "off",
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always"],
      "no-fallthrough": "error",
      "no-async-promise-executor": "error",
    },
  },
  {
    ignores: ["node_modules/", "tierlists/", "*.log", "package-lock.json"],
  },
];
