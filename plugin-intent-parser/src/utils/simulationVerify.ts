import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";

/** SPL Token program — transfer = 3 */
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_TRANSFER_IX = 3;

export interface TokenTransfer {
  mint: string;
  from: string;
  to: string;
  amount: number;
}

export interface SimResult {
  safe: boolean;
  reason?: string;
  actualTransfers: TokenTransfer[];
}

export type SimulateVerifyMode = "transfer" | "swap";

export interface SimulateAndVerifyParams {
  userWallet: string;
  intendedAmountUsdc: number;
  intendedRecipient: string;
  usdcMint: string;
  mode: SimulateVerifyMode;
  maxSolTransfer?: number;
  slippageMultiplier?: number;
}

const DEFAULT_ALLOWED = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bv",
  "ComputeBudget111111111111111111111111111111",
  "11111111111111111111111111111111",
  /** SPL Memo v2 — used e.g. phone-claim escrow lock attribution */
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcEo",
]);

const LAMPORTS_PER_SOL = 1_000_000_000n;

export function buildAllowedPrograms(jupiterProgramId?: string): Set<string> {
  const s = new Set(DEFAULT_ALLOWED);
  const jup = jupiterProgramId?.trim();
  if (jup) s.add(jup);
  return s;
}

function normalizeAddr(a: string): string {
  return new PublicKey(a.trim()).toBase58();
}

function decodeIxData(s: string): Buffer {
  try {
    const b = Buffer.from(s, "base64");
    if (b.length > 0) return b;
  } catch {
    /* fall through */
  }
  try {
    return Buffer.from(bs58.decode(s));
  } catch {
    return Buffer.alloc(0);
  }
}

function rawToHuman(amountRaw: bigint, decimals: number): number {
  return Number(amountRaw) / 10 ** decimals;
}

export type RawTokenTransfer = { from: string; to: string; amountRaw: bigint };

export function parseSplTransfers(
  accountKeys: PublicKey[],
  instructions: Array<{
    programIdIndex: number;
    accounts: number[];
    data: string;
  }>
): RawTokenTransfer[] {
  const out: RawTokenTransfer[] = [];
  for (const ix of instructions) {
    const pid = accountKeys[ix.programIdIndex];
    if (!pid || pid.toBase58() !== TOKEN_PROGRAM_ID) continue;
    const data = decodeIxData(ix.data);
    if (data.length < 9 || data[0] !== TOKEN_TRANSFER_IX) continue;
    const amt = data.readBigUInt64LE(1);
    if (ix.accounts.length < 3) continue;
    const srcIdx = ix.accounts[0]!;
    const dstIdx = ix.accounts[1]!;
    const src = accountKeys[srcIdx]?.toBase58();
    const dst = accountKeys[dstIdx]?.toBase58();
    if (!src || !dst) continue;
    out.push({ from: src, to: dst, amountRaw: amt });
  }
  return out;
}

function flattenAllInstructions(
  accountKeys: PublicKey[],
  innerInstructions:
    | Array<{
        index: number;
        instructions: Array<{
          programIdIndex: number;
          accounts: number[];
          data: string;
        }>;
      }>
    | null
    | undefined,
  topLevel: Array<{
    programIdIndex: number;
    accounts: number[];
    data: string;
  }>
): Array<{ programIdIndex: number; accounts: number[]; data: string }> {
  const inner = innerInstructions?.flatMap((g) => g.instructions) ?? [];
  return [...topLevel, ...inner];
}

function maxSystemTransferFromUser(
  accountKeys: PublicKey[],
  instructions: Array<{ programIdIndex: number; accounts: number[]; data: string }>,
  userWallet: string
): bigint {
  const sys = "11111111111111111111111111111111";
  let maxOut = 0n;
  const userPk = normalizeAddr(userWallet);
  for (const ix of instructions) {
    const pid = accountKeys[ix.programIdIndex]?.toBase58();
    if (pid !== sys) continue;
    const data = decodeIxData(ix.data);
    if (data.length < 12) continue;
    const type = data.readUInt32LE(0);
    if (type !== 2) continue;
    const lamports = data.readBigUInt64LE(4);
    if (ix.accounts.length < 2) continue;
    const fromIdx = ix.accounts[0]!;
    const from = accountKeys[fromIdx]?.toBase58();
    if (from === userPk && lamports > maxOut) maxOut = lamports;
  }
  return maxOut;
}

function assertProgramsAllowed(
  accountKeys: PublicKey[],
  instructions: Array<{ programIdIndex: number; accounts: number[]; data: string }>,
  allowed: Set<string>
): string | null {
  for (const ix of instructions) {
    const pid = accountKeys[ix.programIdIndex]?.toBase58();
    if (!pid || !allowed.has(pid)) {
      return "unknown_program";
    }
  }
  return null;
}

interface SimValue {
  err: unknown;
  innerInstructions?: Array<{
    index: number;
    instructions: Array<{
      programIdIndex: number;
      accounts: number[];
      data: string;
    }>;
  }>;
}

async function rpcSimulateLegacy(
  connection: Connection,
  serializedBase64: string
): Promise<SimValue> {
  const res = await fetch(connection.rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: [
        serializedBase64,
        {
          encoding: "base64",
          commitment: "confirmed",
          innerInstructions: true,
          sigVerify: false,
        },
      ],
    }),
  });
  const json = (await res.json()) as {
    result?: { value: SimValue };
    error?: { message: string };
  };
  if (json.error) {
    return { err: json.error.message };
  }
  return json.result?.value ?? { err: "no_result" };
}

async function simulateLegacyForMeta(
  connection: Connection,
  tx: Transaction
): Promise<{ err: unknown; accountKeys: PublicKey[]; innerInstructions: SimValue["innerInstructions"]; topLevel: CompiledIx[] }> {
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const b64 = Buffer.from(wire).toString("base64");
  const value = await rpcSimulateLegacy(connection, b64);
  if (value.err) {
    return { err: value.err, accountKeys: [], innerInstructions: undefined, topLevel: [] };
  }
  const m = tx.compileMessage();
  const accountKeys = m.accountKeys;
  const topLevel: CompiledIx[] = m.compiledInstructions.map((ix) => ({
    programIdIndex: ix.programIdIndex,
    accounts: [...ix.accountKeyIndexes],
    data: Buffer.from(ix.data).toString("base64"),
  }));
  return { err: value.err, accountKeys, innerInstructions: value.innerInstructions, topLevel };
}

type CompiledIx = { programIdIndex: number; accounts: number[]; data: string };

async function resolveVersionedAccountKeys(
  connection: Connection,
  vtx: VersionedTransaction
): Promise<PublicKey[]> {
  const msg = vtx.message;
  const stat = msg.getAccountKeys();
  const base = [...stat.staticAccountKeys];
  const lookups = msg.addressTableLookups;
  if (!lookups?.length) return base;
  const loaded: PublicKey[] = [];
  for (const lut of lookups) {
    const res = await connection.getAddressLookupTable(lut.accountKey);
    const state = res.value;
    if (!state) continue;
    const addresses = state.state.addresses;
    for (const wi of lut.writableIndexes) {
      const a = addresses[wi];
      if (a) loaded.push(a);
    }
    for (const ri of lut.readonlyIndexes) {
      const a = addresses[ri];
      if (a) loaded.push(a);
    }
  }
  return [...base, ...loaded];
}

async function simulateVersionedForMeta(
  connection: Connection,
  vtx: VersionedTransaction
): Promise<{ err: unknown; accountKeys: PublicKey[]; innerInstructions: SimValue["innerInstructions"]; topLevel: CompiledIx[] }> {
  const msg = vtx.message;
  let accountKeys: PublicKey[];
  try {
    accountKeys = await resolveVersionedAccountKeys(connection, vtx);
  } catch (e) {
    return {
      err: `lookup_table_resolution_failed:${e instanceof Error ? e.message : String(e)}`,
      accountKeys: [],
      innerInstructions: undefined,
      topLevel: [],
    };
  }
  const res = await connection.simulateTransaction(vtx, {
    commitment: "confirmed",
    innerInstructions: true,
    sigVerify: false,
  });
  const v = res.value;
  const topLevel: CompiledIx[] = msg.compiledInstructions.map((ix) => ({
    programIdIndex: ix.programIdIndex,
    accounts: [...ix.accountKeyIndexes],
    data: Buffer.from(ix.data).toString("base64"),
  }));
  return {
    err: v.err,
    accountKeys,
    innerInstructions: v.innerInstructions as SimValue["innerInstructions"],
    topLevel,
  };
}

function usdcTransfersFromRaw(
  raw: RawTokenTransfer[],
  userUsdcAta: string,
  usdcMint: string,
  decimals: number
): TokenTransfer[] {
  return raw
    .filter((r) => r.from === userUsdcAta)
    .map((r) => ({
      mint: usdcMint,
      from: r.from,
      to: r.to,
      amount: rawToHuman(r.amountRaw, decimals),
    }));
}

/**
 * Run simulation + policy checks. Transaction must be signable / partially signed for simulation.
 */
export async function simulateAndVerifyCore(
  connection: Connection,
  tx: Transaction,
  params: SimulateAndVerifyParams,
  allowedPrograms: Set<string>
): Promise<SimResult> {
  const { userWallet, intendedAmountUsdc, intendedRecipient, usdcMint, mode } = params;
  const maxSol = params.maxSolTransfer ?? 0.01;
  const slip = params.slippageMultiplier ?? 1.02;
  const decimals = 6;

  const sim = await simulateLegacyForMeta(connection, tx);
  if (sim.err) {
    return { safe: false, reason: `simulation_failed:${String(sim.err)}`, actualTransfers: [] };
  }

  const flat = flattenAllInstructions(sim.accountKeys, sim.innerInstructions, sim.topLevel);
  const badProg = assertProgramsAllowed(sim.accountKeys, flat, allowedPrograms);
  if (badProg) {
    return { safe: false, reason: badProg, actualTransfers: [] };
  }

  const userPk = normalizeAddr(userWallet);
  const maxLamports = BigInt(Math.floor(maxSol * Number(LAMPORTS_PER_SOL)));
  const sysLamports = maxSystemTransferFromUser(sim.accountKeys, flat, userPk);
  if (sysLamports > maxLamports) {
    return { safe: false, reason: "sol_transfer_exceeds_limit", actualTransfers: [] };
  }

  const raw = parseSplTransfers(sim.accountKeys, flat);
  const userUsdcAta = (
    await getAssociatedTokenAddress(new PublicKey(usdcMint), new PublicKey(userPk))
  ).toBase58();

  const transfers = usdcTransfersFromRaw(raw, userUsdcAta, usdcMint, decimals);
  const totalOut = transfers.reduce((s, t) => s + t.amount, 0);

  if (transfers.length === 0 && intendedAmountUsdc > 0) {
    return { safe: false, reason: "no_usdc_transfer", actualTransfers: transfers };
  }

  if (totalOut > intendedAmountUsdc * slip + 1e-9) {
    return {
      safe: false,
      reason: "usdc_amount_exceeds_intent",
      actualTransfers: transfers,
    };
  }

  if (mode === "transfer") {
    const normalizedIntended = normalizeAddr(intendedRecipient);
    const expectedAta = (
      await getAssociatedTokenAddress(new PublicKey(usdcMint), new PublicKey(normalizedIntended))
    ).toBase58();
    const wrongDest = transfers.filter((t) => t.to !== expectedAta);
    if (wrongDest.length > 0) {
      return { safe: false, reason: "recipient_mismatch", actualTransfers: transfers };
    }
    const uniqueDests = new Set(transfers.map((t) => t.to));
    if (uniqueDests.size > 1) {
      return { safe: false, reason: "multiple_recipients", actualTransfers: transfers };
    }
  }

  return { safe: true, actualTransfers: transfers };
}

export async function simulateAndVerifyVersionedCore(
  connection: Connection,
  vtx: VersionedTransaction,
  params: SimulateAndVerifyParams,
  allowedPrograms: Set<string>
): Promise<SimResult> {
  const { userWallet, intendedAmountUsdc, intendedRecipient, usdcMint, mode } = params;
  const maxSol = params.maxSolTransfer ?? 0.01;
  const slip = params.slippageMultiplier ?? 1.02;
  const decimals = 6;

  const sim = await simulateVersionedForMeta(connection, vtx);
  if (sim.err && typeof sim.err === "string") {
    return { safe: false, reason: sim.err, actualTransfers: [] };
  }
  if (sim.err) {
    return { safe: false, reason: `simulation_failed:${JSON.stringify(sim.err)}`, actualTransfers: [] };
  }

  const flat = flattenAllInstructions(sim.accountKeys, sim.innerInstructions, sim.topLevel);
  const badProg = assertProgramsAllowed(sim.accountKeys, flat, allowedPrograms);
  if (badProg) {
    return { safe: false, reason: badProg, actualTransfers: [] };
  }

  const userPk = normalizeAddr(userWallet);
  const maxLamports = BigInt(Math.floor(maxSol * Number(LAMPORTS_PER_SOL)));
  const sysLamports = maxSystemTransferFromUser(sim.accountKeys, flat, userPk);
  if (sysLamports > maxLamports) {
    return { safe: false, reason: "sol_transfer_exceeds_limit", actualTransfers: [] };
  }

  const raw = parseSplTransfers(sim.accountKeys, flat);
  const userUsdcAta = (
    await getAssociatedTokenAddress(new PublicKey(usdcMint), new PublicKey(userPk))
  ).toBase58();

  const transfers = usdcTransfersFromRaw(raw, userUsdcAta, usdcMint, decimals);
  const totalOut = transfers.reduce((s, t) => s + t.amount, 0);

  if (transfers.length === 0 && intendedAmountUsdc > 0) {
    return { safe: false, reason: "no_usdc_transfer", actualTransfers: transfers };
  }

  if (totalOut > intendedAmountUsdc * slip + 1e-9) {
    return {
      safe: false,
      reason: "usdc_amount_exceeds_intent",
      actualTransfers: transfers,
    };
  }

  if (mode === "transfer") {
    const normalizedIntended = normalizeAddr(intendedRecipient);
    const expectedAta = (
      await getAssociatedTokenAddress(new PublicKey(usdcMint), new PublicKey(normalizedIntended))
    ).toBase58();
    const wrongDest = transfers.filter((t) => t.to !== expectedAta);
    if (wrongDest.length > 0) {
      return { safe: false, reason: "recipient_mismatch", actualTransfers: transfers };
    }
    const uniqueDests = new Set(transfers.map((t) => t.to));
    if (uniqueDests.size > 1) {
      return { safe: false, reason: "multiple_recipients", actualTransfers: transfers };
    }
  }

  return { safe: true, actualTransfers: transfers };
}
