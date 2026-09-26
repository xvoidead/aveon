// То немногое из electron, что нужно src/ на Android
import { Buffer } from 'buffer';
import { Aveon } from '../native.js';

export const app = { getPath: () => '/aveon' };

// Файлы и так шифруются ключом из Android Keystore (shims/fs.js), здесь только упаковка
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(String(s), 'utf8'),
  decryptString: (b) => Buffer.from(b).toString('utf8'),
};

export const shell = {
  openExternal: (url) => Aveon.openUrl({ url: String(url) }),
};

export default { app, safeStorage, shell };
