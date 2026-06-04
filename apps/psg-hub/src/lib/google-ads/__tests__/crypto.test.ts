import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encryptRefreshToken,
  decryptRefreshToken,
  _resetKeyMapCacheForTests,
} from "@/lib/google-ads/crypto";

beforeEach(() => {
  _resetKeyMapCacheForTests();
});

describe("crypto — encrypt/decrypt", () => {
  it("round-trip returns the original plaintext", () => {
    const plaintext = "refresh-token-abc123-!@#$%";
    const { ciphertext, keyVersion } = encryptRefreshToken(plaintext);
    const decrypted = decryptRefreshToken(ciphertext, keyVersion);
    expect(decrypted).toBe(plaintext);
  });

  it("tampered ciphertext byte → throws on decrypt", () => {
    const { ciphertext, keyVersion } = encryptRefreshToken("hello");
    // Flip a byte in the ciphertext body (not the IV)
    const tampered = Buffer.from(ciphertext);
    tampered[14] ^= 0xff;
    expect(() => decryptRefreshToken(tampered, keyVersion)).toThrow();
  });

  it("tampered auth tag → throws", () => {
    const { ciphertext, keyVersion } = encryptRefreshToken("hello");
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptRefreshToken(tampered, keyVersion)).toThrow();
  });

  it("unknown key version → throws", () => {
    const { ciphertext } = encryptRefreshToken("hello");
    expect(() => decryptRefreshToken(ciphertext, 99)).toThrow(
      /Unknown key version/
    );
  });

  it("distinct IVs on repeated encrypts of same plaintext", () => {
    const a = encryptRefreshToken("same").ciphertext;
    const b = encryptRefreshToken("same").ciphertext;
    expect(a.equals(b)).toBe(false);
  });
});

describe("crypto — no plaintext logging", () => {
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
    const plaintext = "very-secret-refresh-token-xyz999";
    const { ciphertext, keyVersion } = encryptRefreshToken(plaintext);
    decryptRefreshToken(ciphertext, keyVersion);
    for (const line of logs) {
      expect(line).not.toContain(plaintext);
    }
  });
});
