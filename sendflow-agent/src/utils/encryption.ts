import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  pbkdf2Sync,
  timingSafeEqual,
} from "node:crypto";

export function getMasterKey(): string {
  const key = process.env.WALLET_ENCRYPTION_KEY?.trim();
  if (!key || key.length < 32) {
    if (process.env.NODE_ENV === "production") {
      console.error("FATAL: WALLET_ENCRYPTION_KEY must be 32+ characters in production");
      process.exit(1);
    }
    console.warn("WARNING: Using weak WALLET_ENCRYPTION_KEY — never use in production");
    return "sendflow_dev_key_DO_NOT_USE_IN_PROD_32x";
  }
  return key;
}

/** Zeroize sensitive byte buffers after use. */
export function zeroize(buf: Buffer | Uint8Array): void {
  buf.fill(0);
}

/** Legacy: HMAC-SHA256(master, userId) — used for KEY_VERSION 2 AES-GCM only. */
export function deriveUserKeyLegacy(userId: string, masterKey: string): Buffer {
  return createHmac("sha256", masterKey).update(userId).digest();
}

/**
 * PBKDF2-SHA-256 (100k iterations) on top of HMAC-derived material.
 * Same output whether using Web Crypto or Node fallback.
 */
export async function deriveUserAesKeyPbkdf2(userId: string, masterKey: string): Promise<Buffer> {
  const base = createHmac("sha256", masterKey).update(userId).digest();
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const keyMaterial = await subtle.importKey("raw", base, "PBKDF2", false, ["deriveBits"]);
      const salt = new TextEncoder().encode(userId);
      const bits = await subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
        keyMaterial,
        256
      );
      const out = Buffer.from(bits);
      zeroize(base);
      return out;
    }
  } catch {
    /* fall through */
  }
  const out = Buffer.from(
    pbkdf2Sync(base, Buffer.from(userId, "utf8"), 100_000, 32, "sha256")
  );
  zeroize(base);
  return out;
}

export async function encryptPrivateKey(privateKey: Uint8Array, userId: string, masterKey: string): Promise<string> {
  const userKey = await deriveUserAesKeyPbkdf2(userId, masterKey);
  try {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", userKey, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(privateKey)), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, encrypted].map((b) => b.toString("hex")).join(":");
  } finally {
    zeroize(userKey);
  }
}

/** Decrypt KEY_VERSION 3 (PBKDF2) ciphertext. Caller must zeroize returned buffer. */
export async function decryptPrivateKeyBytes(
  encryptedData: string,
  userId: string,
  masterKey: string
): Promise<Buffer> {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted payload");
  const [ivHex, authTagHex, encryptedHex] = parts;
  const userKey = await deriveUserAesKeyPbkdf2(userId, masterKey);
  try {
    const decipher = createDecipheriv("aes-256-gcm", userKey, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]);
  } finally {
    zeroize(userKey);
  }
}

/** KEY_VERSION 2 — HMAC-only key (no PBKDF2). Caller must zeroize returned buffer. */
export function decryptPrivateKeyBytesV2(encryptedData: string, userId: string, masterKey: string): Buffer {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted payload");
  const [ivHex, authTagHex, encryptedHex] = parts;
  const userKey = deriveUserKeyLegacy(userId, masterKey);
  try {
    const decipher = createDecipheriv("aes-256-gcm", userKey, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]);
  } finally {
    zeroize(userKey);
  }
}

/** Legacy AES-256-CBC (v1) — single master key, no per-user derivation */
export function decryptLegacyCbc(encryptedData: string, legacyKeyMaterial: Buffer): string {
  const [ivHex, encrypted] = encryptedData.split(":");
  if (!ivHex || !encrypted) throw new Error("Invalid legacy payload");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", Buffer.alloc(32, legacyKeyMaterial), iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function computeWalletMac(encryptedPrivateKey: string, masterKey: string): string {
  return createHmac("sha256", masterKey).update(encryptedPrivateKey, "utf8").digest("hex");
}

export function verifyWalletMac(encryptedPrivateKey: string, mac: string | undefined, masterKey: string): boolean {
  if (!mac) return true;
  const expected = computeWalletMac(encryptedPrivateKey, masterKey);
  return timingSafeEqualHex(expected, mac);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
