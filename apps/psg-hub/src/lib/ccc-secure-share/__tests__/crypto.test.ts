import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encryptCredential,
  decryptCredential,
  _resetKeyMapCacheForTests,
} from "@/lib/ccc-secure-share/crypto";

beforeEach(() => {
  _resetKeyMapCacheForTests();
});

describe("ccc crypto — encrypt/decrypt", () => {
  it("round-trip returns the original plaintext", () => {
    const plaintext = "ccc-secure-share-cred-abc123-!@#$%";
    const { ciphertext, keyVersion } = encryptCredential(plaintext);
    const decrypted = decryptCredential(ciphertext, keyVersion);
    expect(decrypted).toBe(plaintext);
  });

  it("tampered ciphertext byte → throws on decrypt", () => {
    const { ciphertext, keyVersion } = encryptCredential("hello");
    const tampered = Buffer.from(ciphertext);
    tampered[14] ^= 0xff;
    expect(() => decryptCredential(tampered, keyVersion)).toThrow();
  });

  it("tampered auth tag → throws", () => {
    const { ciphertext, keyVersion } = encryptCredential("hello");
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptCredential(tampered, keyVersion)).toThrow();
  });

  it("unknown key version → throws", () => {
    const { ciphertext } = encryptCredential("hello");
    expect(() => decryptCredential(ciphertext, 99)).toThrow(
      /Unknown key version/
    );
  });

  it("ciphertext too short → throws", () => {
    expect(() => decryptCredential(Buffer.alloc(4), 1)).toThrow(
      /Ciphertext too short/
    );
  });

  it("distinct IVs on repeated encrypts of same plaintext", () => {
    const a = encryptCredential("same").ciphertext;
    const b = encryptCredential("same").ciphertext;
    expect(a.equals(b)).toBe(false);
  });
});

describe("ccc crypto — key-version selection", () => {
  const origV2 = process.env.CCC_ENCRYPTION_KEY_V2;

  afterEach(() => {
    if (origV2 === undefined) delete process.env.CCC_ENCRYPTION_KEY_V2;
    else process.env.CCC_ENCRYPTION_KEY_V2 = origV2;
    _resetKeyMapCacheForTests();
  });

  it("with only v1 set, encrypt stamps keyVersion 1", () => {
    delete process.env.CCC_ENCRYPTION_KEY_V2;
    _resetKeyMapCacheForTests();
    const { keyVersion } = encryptCredential("x");
    expect(keyVersion).toBe(1);
  });

  it("encrypt always selects the HIGHEST available key version", () => {
    process.env.CCC_ENCRYPTION_KEY_V2 = Buffer.alloc(32, 9).toString("base64");
    _resetKeyMapCacheForTests();
    const { ciphertext, keyVersion } = encryptCredential("rotated");
    expect(keyVersion).toBe(2);
    // and an older-version ciphertext still decrypts with its stamped version
    expect(decryptCredential(ciphertext, keyVersion)).toBe("rotated");
  });

  it("a non-32-byte env key is rejected", () => {
    process.env.CCC_ENCRYPTION_KEY_V2 = Buffer.alloc(16, 9).toString("base64");
    _resetKeyMapCacheForTests();
    expect(() => encryptCredential("x")).toThrow(/exactly 32 bytes/);
  });
});

describe("ccc crypto — no plaintext logging", () => {
  let logs: string[] = [];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    logs = [];
    origLog = console.log;
    origErr = console.error;
    const capture = (..._args: unknown[]) => {
      logs.push(_args.map((a) => String(a)).join(" "));
    };
    console.log = vi.fn(capture);
    console.error = vi.fn(capture);
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
  });

  it("encrypt + decrypt round-trip produces no log containing plaintext", () => {
    const plaintext = "very-secret-ccc-credential-xyz999";
    const { ciphertext, keyVersion } = encryptCredential(plaintext);
    decryptCredential(ciphertext, keyVersion);
    for (const line of logs) {
      expect(line).not.toContain(plaintext);
    }
  });
});
