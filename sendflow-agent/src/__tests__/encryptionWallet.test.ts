import { describe, test, expect, afterEach } from "bun:test";
import {
  zeroize,
  deriveUserAesKeyPbkdf2,
  computeWalletMac,
  verifyWalletMac,
  encryptPrivateKey,
  decryptPrivateKeyBytes,
} from "../utils/encryption";
import * as custodial from "../utils/custodialWallet";

describe("encryption", () => {
  const origKey = process.env.WALLET_ENCRYPTION_KEY;

  afterEach(() => {
    process.env.WALLET_ENCRYPTION_KEY = origKey;
  });

  test("zeroize clears bytes", () => {
    const b = Buffer.from([1, 2, 3, 4]);
    zeroize(b);
    expect([...b]).toEqual([0, 0, 0, 0]);
    const u = new Uint8Array([9, 9]);
    zeroize(u);
    expect([...u]).toEqual([0, 0]);
  });

  test("PBKDF2 yields different AES keys per userId", async () => {
    process.env.WALLET_ENCRYPTION_KEY = "test_master_key_32_chars_min______";
    const master = process.env.WALLET_ENCRYPTION_KEY;
    const a = await deriveUserAesKeyPbkdf2("user-a", master);
    const b = await deriveUserAesKeyPbkdf2("user-b", master);
    expect(a.equals(b)).toBe(false);
    zeroize(a);
    zeroize(b);
  });

  test("verifyWalletMac rejects tampered ciphertext", () => {
    const master = "test_master_key_32_chars_min______";
    const ct = "dead:beef:cafe";
    const mac = computeWalletMac(ct, master);
    expect(verifyWalletMac(ct, mac, master)).toBe(true);
    expect(verifyWalletMac(`${ct}x`, mac, master)).toBe(false);
  });

  test("encrypt/decrypt round-trip per user", async () => {
    process.env.WALLET_ENCRYPTION_KEY = "test_master_key_32_chars_min______";
    const master = process.env.WALLET_ENCRYPTION_KEY;
    const sk = Buffer.alloc(64);
    sk.fill(7);
    const enc = await encryptPrivateKey(sk, "uid-1", master);
    const dec = await decryptPrivateKeyBytes(enc, "uid-1", master);
    expect(dec.equals(sk)).toBe(true);
    zeroize(sk);
    zeroize(dec);
  });
});

describe("custodialWallet public API", () => {
  test("does not export raw key accessors", () => {
    const keys = Object.keys(custodial);
    expect(keys).not.toContain("getPrivateKeyBase58");
    expect(keys).not.toContain("decryptWalletSecretKey");
    expect(keys).toContain("signTransaction");
    expect(keys).toContain("signMessage");
    expect(keys).toContain("signVersionedTransaction");
  });
});
