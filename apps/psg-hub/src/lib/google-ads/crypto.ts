import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let _keyMapCache: Record<number, Buffer> | null = null;
let _currentVersionCache: number | null = null;

function loadKeyMap(): {
  map: Record<number, Buffer>;
  currentVersion: number;
} {
  if (_keyMapCache && _currentVersionCache !== null) {
    return { map: _keyMapCache, currentVersion: _currentVersionCache };
  }

  const map: Record<number, Buffer> = {};

  function loadFrom(envKey: string, version: number) {
    const v = process.env[envKey];
    if (!v) return;
    const buf = Buffer.from(v, "base64");
    if (buf.length !== 32) {
      throw new Error(
        `${envKey} must decode to exactly 32 bytes; got ${buf.length}`
      );
    }
    map[version] = buf;
  }

  loadFrom("ADS_ENCRYPTION_KEY", 1);
  for (let v = 2; v <= 10; v++) {
    loadFrom(`ADS_ENCRYPTION_KEY_V${v}`, v);
  }

  const versions = Object.keys(map)
    .map(Number)
    .sort((a, b) => b - a);

  if (versions.length === 0) {
    throw new Error("No ADS_ENCRYPTION_KEY set");
  }

  _keyMapCache = map;
  _currentVersionCache = versions[0];
  return { map, currentVersion: _currentVersionCache };
}

export function encryptRefreshToken(plaintext: string): {
  ciphertext: Buffer;
  keyVersion: number;
} {
  const { map, currentVersion } = loadKeyMap();
  const key = map[currentVersion];
  const iv = randomBytes(IV_LEN);
  const cipher: CipherGCM = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, enc, tag]),
    keyVersion: currentVersion,
  };
}

export function decryptRefreshToken(
  ciphertext: Buffer,
  keyVersion: number
): string {
  const { map } = loadKeyMap();
  const key = map[keyVersion];
  if (!key) {
    throw new Error(`Unknown key version: ${keyVersion}`);
  }
  if (ciphertext.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Ciphertext too short");
  }
  const iv = ciphertext.subarray(0, IV_LEN);
  const tag = ciphertext.subarray(ciphertext.length - TAG_LEN);
  const data = ciphertext.subarray(IV_LEN, ciphertext.length - TAG_LEN);
  const decipher: DecipherGCM = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

// Test-only hook
export function _resetKeyMapCacheForTests() {
  _keyMapCache = null;
  _currentVersionCache = null;
}
