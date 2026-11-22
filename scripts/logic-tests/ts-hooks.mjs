// Hooks so Node's built-in test runner can import the app's TypeScript modules
// directly (Node strips the types itself):
//   - maps the "@/x" alias to src/x
//   - adds the missing ".ts" extension to extensionless imports
//   - swaps native-only packages for the small stand-ins in ./stubs
//   - compiles the JSX in ".tsx" files (only src/lib/store.tsx is tested this way)
// Loaded with `node --import ./scripts/logic-tests/ts-hooks.mjs` (see "npm test").
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js'];

const stubs = {
  'expo-notifications': path.join(here, 'stubs', 'expo-notifications.mjs'),
  '@react-native-async-storage/async-storage': path.join(here, 'stubs', 'async-storage.mjs'),
  'react-native': path.join(here, 'stubs', 'react-native.mjs'),
  'expo-haptics': path.join(here, 'stubs', 'expo-haptics.mjs'),
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(stubs, specifier)) {
      return nextResolve(pathToFileURL(stubs[specifier]).href, context);
    }

    let target = null;
    if (specifier.startsWith('@/')) {
      target = path.join(root, 'src', specifier.slice(2));
    } else if (
      specifier.startsWith('.') &&
      context.parentURL?.startsWith('file:') &&
      !context.parentURL.includes('/node_modules/')
    ) {
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }

    if (target !== null) {
      if (path.extname(target) && existsSync(target)) {
        return nextResolve(pathToFileURL(target).href, context);
      }
      for (const extension of extensions) {
        if (existsSync(target + extension)) {
          return nextResolve(pathToFileURL(target + extension).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    // Node strips types but does not understand JSX, so .tsx goes through TypeScript.
    if (url.startsWith('file:') && new URL(url).pathname.endsWith('.tsx')) {
      const source = readFileSync(fileURLToPath(url), 'utf8');
      const { outputText } = ts.transpileModule(source, {
        fileName: fileURLToPath(url),
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ESNext,
        },
      });
      return { format: 'module', source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
