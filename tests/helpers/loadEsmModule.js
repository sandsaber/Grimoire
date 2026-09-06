/**
 * Loads a real ES module by absolute URL, past Jest's registry.
 *
 * Deliberately a plain `.js` file: the transform in `jest.config.js` matches
 * only `.tsx?`, so nothing rewrites this `import()` into a `require()`. That
 * rewrite is what stops a TypeScript suite from loading an ESM-only package —
 * it puts the module back through the module-name mapper, which for
 * `@anthropic-ai/claude-agent-sdk` answers with the repository's mock.
 *
 * The caller needs `NODE_OPTIONS=--experimental-vm-modules`, because a dynamic
 * import inside Jest's VM context is gated on it.
 */
async function loadEsmModule(url) {
  return import(url);
}

module.exports = { loadEsmModule };
