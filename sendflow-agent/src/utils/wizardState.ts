export interface WizardStep {
  step: "amount" | "recipient" | "confirm" | "custom_amount" | "custom_recipient";
  amount?: number;
  recipient?: string;
  recipientLabel?: string;
}

const wizardStore = new Map<string, WizardStep>();

export function startWizard(userId: string): void {
  wizardStore.set(userId, { step: "amount" });
}

export function getWizard(userId: string): WizardStep | null {
  return wizardStore.get(userId) ?? null;
}

export function updateWizard(userId: string, update: Partial<WizardStep>): WizardStep {
  const current = wizardStore.get(userId) ?? { step: "amount" };
  const next = { ...current, ...update };
  wizardStore.set(userId, next);
  return next;
}

export function clearWizard(userId: string): void {
  wizardStore.delete(userId);
}

export function isInWizard(userId: string): boolean {
  return wizardStore.has(userId);
}

/** After welcome keyboard: next chat message is interpreted with this intent. */
export type OnboardingPromptKind = "send" | "request" | "addfunds" | "wallet";

const onboardingPromptByUser = new Map<string, OnboardingPromptKind>();

export function setOnboardingPrompt(userId: string, kind: OnboardingPromptKind): void {
  onboardingPromptByUser.set(userId, kind);
}

export function takeOnboardingPrompt(userId: string): OnboardingPromptKind | undefined {
  const k = onboardingPromptByUser.get(userId);
  onboardingPromptByUser.delete(userId);
  return k;
}

export function peekOnboardingPrompt(userId: string): OnboardingPromptKind | undefined {
  return onboardingPromptByUser.get(userId);
}

/** @internal tests */
export function __clearOnboardingPromptForTests(userId?: string): void {
  if (userId) onboardingPromptByUser.delete(userId);
  else onboardingPromptByUser.clear();
}

/** Marks an in-flight behavioral inline confirm (mirrors behavioralAuth pending TTL). */
const behavioralWizard = new Map<string, { pendingId: string; expiresAt: number }>();

export function setBehavioralWizardPending(userId: string, pendingId: string, expiresAt: number): void {
  behavioralWizard.set(userId, { pendingId, expiresAt });
}

export function clearBehavioralWizardPending(userId: string): void {
  behavioralWizard.delete(userId);
}

export function getBehavioralWizardPending(userId: string): { pendingId: string; expiresAt: number } | undefined {
  return behavioralWizard.get(userId);
}
