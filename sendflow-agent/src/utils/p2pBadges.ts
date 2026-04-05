import type { P2PReputation } from "./p2pMarket";

export function calculateBadges(rep: P2PReputation): string[] {
  const badges: string[] = [];
  if (rep.completedTrades >= 100) badges.push("Century Trader");
  if (rep.completedTrades >= 10) badges.push("Experienced");
  if (rep.avgResponseMinutes <= 5 && rep.completedTrades >= 3) badges.push("Fast Responder");
  if (rep.totalVolume >= 10_000) badges.push("High Volume");
  if (rep.disputedTrades === 0 && rep.completedTrades >= 5) badges.push("Zero Disputes");
  if (rep.verified) badges.push("KYC Verified");
  return badges;
}

export function formatReputationLine(rep: P2PReputation): string {
  const stars = "⭐".repeat(Math.max(1, Math.min(5, Math.round(rep.rating))));
  const badges = calculateBadges(rep);
  const badgeStr = badges.length ? badges.join(" · ") : "—";
  return `${stars} ${rep.rating.toFixed(1)} | ${rep.completedTrades} trades | ${badgeStr}`;
}
