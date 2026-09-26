// Глобальные Node-имена для src/ в сборке моста (esbuild inject): Buffer, process и fetch без CORS
export { Buffer } from 'buffer';
export { nativeFetch as fetch } from './fetch.js';
export const process = { platform: 'android', env: {} };
export const global = globalThis;
