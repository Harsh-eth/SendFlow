const discoveries = new Map<string, Set<string>>();

export function trackFeatureDiscovery(userId: string, feature: string): void {
  let s = discoveries.get(userId);
  if (!s) {
    s = new Set();
    discoveries.set(userId, s);
  }
  s.add(feature);
}

export function getCohortReport(): string {
  const featCounts: Record<string, number> = {};
  for (const set of discoveries.values()) {
    for (const f of set) featCounts[f] = (featCounts[f] ?? 0) + 1;
  }
  const lines = ["<b>Cohort — feature discovery</b>", ""];
  const entries = Object.entries(featCounts).sort((a, b) => b[1] - a[1]);
  for (const [f, c] of entries.slice(0, 20)) {
    lines.push(`• ${f}: <b>${c}</b> users`);
  }
  if (entries.length === 0) lines.push(`No data yet.`);
  return lines.join("\n");
}
