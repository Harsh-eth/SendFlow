let degraded = false;

export function setDegradedMode(v: boolean): void {
  degraded = v;
}

export function isDegradedMode(): boolean {
  return degraded;
}

export function degradedTransferSuffix(): string {
  return degraded ? "\n\n<i>[degraded]</i>" : "";
}
