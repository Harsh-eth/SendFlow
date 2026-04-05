import { sharedGetAllTransfers, type SharedTxRecord } from "@sendflow/plugin-intent-parser";
import { loggerCompat as logger } from "./structuredLogger";

export function validateWebhookUrl(url: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "Only HTTPS URLs allowed" };
  }

  const hostname = parsed.hostname.toLowerCase();

  const privatePatterns = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
    /^0\./,
    /^metadata\.google\.internal$/,
    /^169\.254\.169\.254$/,
  ];

  for (const pattern of privatePatterns) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: "Private/internal URLs not allowed" };
    }
  }

  return { valid: true };
}

export interface BusinessProfile {
  userId: string;
  businessName: string;
  enabled: boolean;
  webhookUrl?: string;
  teamMembers: string[];
  csvExportEnabled: boolean;
  bulkPaymentList: Array<{ label: string; wallet: string; amount: number }>;
}

const businessStore = new Map<string, BusinessProfile>();

export function enableBusiness(userId: string, businessName: string): BusinessProfile {
  const existing = businessStore.get(userId);
  if (existing) {
    existing.enabled = true;
    existing.businessName = businessName;
    return existing;
  }
  const profile: BusinessProfile = {
    userId,
    businessName,
    enabled: true,
    teamMembers: [],
    csvExportEnabled: true,
    bulkPaymentList: [],
  };
  businessStore.set(userId, profile);
  return profile;
}

export function getBusinessProfile(userId: string): BusinessProfile | null {
  return businessStore.get(userId) ?? null;
}

export function isBusinessMode(userId: string): boolean {
  return businessStore.get(userId)?.enabled ?? false;
}

export function setWebhook(userId: string, url: string): void {
  const validation = validateWebhookUrl(url);
  if (!validation.valid) {
    throw new Error(`Webhook URL rejected: ${validation.reason}`);
  }
  const profile = businessStore.get(userId);
  if (!profile) {
    throw new Error("Enable business mode first before setting a webhook");
  }
  profile.webhookUrl = url;
}

export async function triggerWebhook(url: string, payload: object): Promise<void> {
  const validation = validateWebhookUrl(url);
  if (!validation.valid) {
    logger.warn(`Webhook skipped: ${validation.reason}`);
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    logger.warn(`Webhook failed: ${err}`);
  }
}

export function exportTransactionsCSV(userId: string): string {
  const transfers = sharedGetAllTransfers(userId);
  const header = "Date,Recipient,RecipientWallet,Amount,Token,TxHash,Status";
  const rows = transfers.map((tx: SharedTxRecord) =>
    [
      tx.completedAt ?? "",
      tx.receiverLabel ?? "",
      tx.receiverWallet ?? "",
      tx.amount ?? 0,
      "USDC",
      tx.txHash ?? "",
      "Success",
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

export function addBulkPayee(userId: string, label: string, wallet: string, amount: number): void {
  const profile = businessStore.get(userId);
  if (!profile) return;
  profile.bulkPaymentList.push({ label, wallet, amount });
}

export function getBulkPayees(userId: string): Array<{ label: string; wallet: string; amount: number }> {
  return businessStore.get(userId)?.bulkPaymentList ?? [];
}
