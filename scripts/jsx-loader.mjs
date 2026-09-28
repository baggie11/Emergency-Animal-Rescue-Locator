/**
 * ESM loader hook so the DOM test can import the real .jsx sources instead of a
 * stale build. esbuild is already present as a Vite dependency, so this adds no
 * new install.
 *
 * Used via: node --import ./scripts/register-jsx.mjs scripts/dom-smoke.mjs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const JSX_RE = /\.(jsx|js)$/;

export async function load(url, context, nextLoad) {
  // Stylesheets are irrelevant outside a browser build; stub them out.
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }

  if (url.endsWith('.jsx') || (JSX_RE.test(url) && context.parentURL?.includes('/web/'))) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const result = await transform(source, {
      loader: 'jsx',
      jsx: 'automatic',
      format: 'esm',
      target: 'node20',
      // Keep node_modules untouched so CJS interop keeps working.
      sourcefile: fileURLToPath(url),
    });
    return { format: 'module', source: result.code, shortCircuit: true };
  }

  return nextLoad(url, context);
}
