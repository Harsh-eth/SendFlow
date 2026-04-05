/** Detects when `candidate` differs by exactly one character from a trusted address (typosquatting). */
export function isSingleCharTypo(candidate: string, trusted: string): boolean {
  const a = candidate.trim();
  const b = trusted.trim();
  if (a.length !== b.length || a.length < 32) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff === 1;
}

/** Returns the trusted address if `candidate` is a 1-char mutation of any known address. */
export function findTrustedLookalike(candidate: string, knownAddresses: string[]): string | null {
  for (const k of knownAddresses) {
    if (isSingleCharTypo(candidate, k)) return k;
  }
  return null;
}
