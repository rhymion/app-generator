// Runs the generated mobile lib/token-storage.ts (Node strips the types) against injected
// stand-ins for react-native, expo-constants, expo-secure-store and expo-local-authentication.
// argv[2]: path to the .ts file; argv[3]: JSON scenario
//   { executionEnvironment, platformOS, hasHardware, isEnrolled, isEnrolledAfterSave, authCheckThrows, rejectLocked }
// Prints JSON { calls, read } where `calls` records every SecureStore call with its options.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const [, , tsPath, scenarioJson] = process.argv;
const scenario = JSON.parse(scenarioJson);
const calls = [];
const warnings = [];
console.warn = (message) => warnings.push(String(message));
let saved = false;
const store = new Map();
const web = new Map();
globalThis.localStorage = {
  setItem: (k, v) => web.set(k, v),
  getItem: (k) => web.get(k) ?? null,
  removeItem: (k) => web.delete(k),
};

const mocks = {
  'react-native': { Platform: { OS: scenario.platformOS } },
  'expo-constants': {
    default: { executionEnvironment: scenario.executionEnvironment },
    ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
  },
  'expo-local-authentication': {
    hasHardwareAsync: async () => {
      if (scenario.authCheckThrows) throw new Error('auth api down');
      return scenario.hasHardware;
    },
    isEnrolledAsync: async () => (saved && 'isEnrolledAfterSave' in scenario ? scenario.isEnrolledAfterSave : scenario.isEnrolled),
  },
  'expo-secure-store': {
    setItemAsync: async (key, value, options) => {
      calls.push({ fn: 'setItemAsync', key, options: options ?? null });
      if (options?.requireAuthentication && (scenario.rejectLocked || scenario.executionEnvironment === 'storeClient')) {
        throw new Error('MissingPlistKeyException: NSFaceIDUsageDescription');
      }
      store.set(key, value);
    },
    getItemAsync: async (key, options) => {
      calls.push({ fn: 'getItemAsync', key, options: options ?? null });
      return store.get(key) ?? null;
    },
    deleteItemAsync: async (key) => {
      calls.push({ fn: 'deleteItemAsync', key, options: null });
      store.delete(key);
    },
  },
};
globalThis.__mocks = mocks;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in mocks) return { url: `mock:${specifier}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('mock:')) {
      const name = url.slice('mock:'.length);
      const names = Object.keys(mocks[name]).filter((k) => k !== 'default');
      const source =
        (name === 'expo-constants' ? `export default globalThis.__mocks['${name}'].default;\n` : '') +
        names.map((k) => `export const ${k} = globalThis.__mocks['${name}'].${k};`).join('\n');
      return { format: 'module', source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const mod = await import(pathToFileURL(tsPath).href);
let saveError = null;
try {
  await mod.setTokens('access', 'refresh-secret');
} catch (e) {
  saveError = String(e.message);
}
saved = true;
const read = await mod.getRefreshToken();
console.log(JSON.stringify({ calls, read, saveError, warnings }));
