import { TRANSFER_LIMITS } from "./transferLimits";

export interface SponsorshipRecord {
  userId: string;
  sponsoredCount: number;
  maxSponsored: number;
  totalFeePaidLamports: number;
}

const MAX_ENTRIES = 10_000;
const sponsorships = new Map<string, SponsorshipRecord>();

function trimMap(): void {
  while (sponsorships.size >= MAX_ENTRIES) {
    const first = sponsorships.keys().next().value as string | undefined;
    if (first) sponsorships.delete(first);
    else break;
  }
}

function getOrCreate(userId: string): SponsorshipRecord {
  let r = sponsorships.get(userId);
  if (!r) {
    trimMap();
    r = { userId, sponsoredCount: 0, maxSponsored: TRANSFER_LIMITS.GAS_FREE_COUNT, totalFeePaidLamports: 0 };
    sponsorships.set(userId, r);
  }
  return r;
}

export function isEligibleForSponsorship(userId: string): boolean {
  const r = getOrCreate(userId);
  return r.sponsoredCount < r.maxSponsored;
}

export function recordSponsoredTx(userId: string, feeLamports: number): void {
  const r = getOrCreate(userId);
  r.sponsoredCount += 1;
  r.totalFeePaidLamports += feeLamports;
}

export function getRemainingFreeTransfers(userId: string): number {
  const r = getOrCreate(userId);
  return Math.max(0, r.maxSponsored - r.sponsoredCount);
}

export function getSponsorshipMessage(userId: string): string {
  if (!isEligibleForSponsorship(userId)) return "";
  const left = getRemainingFreeTransfers(userId);
  return `\n\n🎁 <b>Fee Sponsored!</b>\nNetwork fee: <b>FREE</b> (${left} of ${TRANSFER_LIMITS.GAS_FREE_COUNT} remaining)`;
}
