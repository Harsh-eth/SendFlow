import { randomBytes } from "node:crypto";
import {
  deactivateAllSchedulesForUser,
  clearAllPendingForEntity,
  clearProcessing,
} from "@sendflow/plugin-intent-parser";
import { persistLoad, persistSave } from "@sendflow/plugin-intent-parser";
import { freezeAccount, notifyAdminFreeze } from "./behavioralAuth";
import { alert } from "./adminAlerter";

export interface RecoveryCodeSet {
  userId: string;
  codes: string[];
  generatedAt: string;
  usedCodes: string[];
}

const FILE = "recovery-codes.json";

function loadAll(): Record<string, RecoveryCodeSet> {
  return persistLoad<Record<string, RecoveryCodeSet>>(FILE, {});
}

function saveAll(m: Record<string, RecoveryCodeSet>): void {
  persistSave(FILE, m);
}

export function generateRecoveryCodes(userId: string): string[] {
  const codes = Array.from({ length: 8 }, () => randomBytes(5).toString("hex"));
  const all = loadAll();
  all[userId] = {
    userId,
    codes,
    generatedAt: new Date().toISOString(),
    usedCodes: [],
  };
  saveAll(all);
  return codes;
}

export function useRecoveryCode(userId: string, code: string): boolean {
  const norm = code.trim().toLowerCase();
  const all = loadAll();
  const set = all[userId];
  if (!set || !set.codes.includes(norm)) return false;
  if (set.usedCodes.includes(norm)) return false;
  set.usedCodes.push(norm);
  saveAll(all);
  return true;
}

export async function emergencyFreeze(userId: string): Promise<void> {
  await freezeAccount(userId, "user_requested");
  deactivateAllSchedulesForUser(userId);
  clearAllPendingForEntity(userId);
  clearProcessing(userId);
  await notifyAdminFreeze(userId, "freeze");
  await alert("critical", "account.emergency_stop", { userId });
}

/**
 * Stub: recovery to a new Telegram ID needs identity verification — instruct user to contact support.
 */
export async function initiateRecovery(_userId: string, _recoveryCode: string, _newTelegramId: string): Promise<boolean> {
  return false;
}
