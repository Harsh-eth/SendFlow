import type { RemittanceIntent } from "@sendflow/plugin-intent-parser";
import { classifyTransferFailure } from "@sendflow/plugin-intent-parser";

export type { RemittanceIntent };

export interface RetryContext {
  userId: string;
  intent: RemittanceIntent;
  failureReason: string;
  failureCode: string;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: string;
}

export { classifyTransferFailure };

export async function retryWithBackoff(
  context: RetryContext,
  executeFn: () => Promise<string>,
  onProgress: (message: string) => Promise<void>
): Promise<{ success: boolean; txHash?: string; finalError?: string }> {
  const c = classifyTransferFailure(new Error(context.failureReason));
  if (!c.retryable || context.attemptCount >= context.maxAttempts) {
    return { success: false, finalError: c.userMessage };
  }
  await onProgress(
    `⏳ Retrying automatically in ${Math.ceil(c.retryDelayMs / 1000)} seconds…\nAttempt ${context.attemptCount + 1} of ${context.maxAttempts}`
  );
  await new Promise((r) => setTimeout(r, c.retryDelayMs));
  try {
    const txHash = await executeFn();
    return { success: true, txHash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return retryWithBackoff(
      {
        ...context,
        attemptCount: context.attemptCount + 1,
        failureReason: msg,
        failureCode: classifyTransferFailure(e).code,
        lastAttemptAt: new Date().toISOString(),
      },
      executeFn,
      onProgress
    );
  }
}
