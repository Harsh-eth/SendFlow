/** Captured outbound Telegram HTML and metadata for E2E harness (NODE_ENV=test + SENDFLOW_E2E=1). */

export interface E2eCaptureSnapshot {
  replies: string[];
  threatLabel?: "safe" | "suspicious" | "block";
  threatBlocked: boolean;
}

const replies: string[] = [];
let threatLabel: "safe" | "suspicious" | "block" | undefined;
let threatBlocked = false;

export function resetE2eCapture(): void {
  replies.length = 0;
  threatLabel = undefined;
  threatBlocked = false;
}

export function pushE2eReply(html: string): void {
  replies.push(html);
}

export function setE2eThreat(label: "safe" | "suspicious" | "block", blocked: boolean): void {
  threatLabel = label;
  threatBlocked = blocked;
}

export function getE2eCaptureSnapshot(): E2eCaptureSnapshot {
  return {
    replies: [...replies],
    threatLabel,
    threatBlocked,
  };
}

export function isE2eMode(): boolean {
  return process.env.NODE_ENV === "test" && process.env.SENDFLOW_E2E === "1";
}
