import { randomBytes } from "node:crypto";

export interface SavingsGoal {
  goalId: string;
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  autoSaveAmount?: number;
  autoSavePercent?: number;
  createdAt: string;
  completed: boolean;
}

const goalsByUser = new Map<string, SavingsGoal[]>();

function list(userId: string): SavingsGoal[] {
  return goalsByUser.get(userId) ?? [];
}

export function createGoal(userId: string, name: string, target: number, deadline?: string): SavingsGoal {
  const g: SavingsGoal = {
    goalId: `g_${randomBytes(8).toString("hex")}`,
    userId,
    name,
    targetAmount: target,
    currentAmount: 0,
    deadline,
    createdAt: new Date().toISOString(),
    completed: false,
  };
  const arr = list(userId);
  arr.push(g);
  goalsByUser.set(userId, arr);
  return g;
}

export function depositToGoal(goalId: string, amount: number): SavingsGoal | null {
  for (const arr of goalsByUser.values()) {
    const g = arr.find((x) => x.goalId === goalId);
    if (g) {
      g.currentAmount += amount;
      if (g.currentAmount >= g.targetAmount) {
        g.currentAmount = g.targetAmount;
        g.completed = true;
      }
      return g;
    }
  }
  return null;
}

export function getGoals(userId: string): SavingsGoal[] {
  return [...list(userId)];
}

export function getProgress(goal: SavingsGoal): string {
  const pct = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
  const left = Math.max(0, goal.targetAmount - goal.currentAmount);
  return `${pct.toFixed(0)}% complete — ${left.toFixed(2)} USDC to go`;
}

export function setAutoSavePercent(userId: string, percent: number): void {
  const arr = list(userId);
  const last = arr[arr.length - 1];
  if (last) last.autoSavePercent = Math.min(100, Math.max(0, percent));
}

export function setAutoSaveAmount(userId: string, amount: number): void {
  const arr = list(userId);
  const last = arr[arr.length - 1];
  if (last) last.autoSaveAmount = amount;
}

/** Track-only hook: bump goal when user receives (caller passes net incoming). */
export function autoSaveFromTransfer(userId: string, incomingAmount: number): void {
  const arr = list(userId);
  for (const g of arr) {
    if (g.completed) continue;
    if (g.autoSavePercent != null) {
      const add = (incomingAmount * g.autoSavePercent) / 100;
      g.currentAmount = Math.min(g.targetAmount, g.currentAmount + add);
      if (g.currentAmount >= g.targetAmount) g.completed = true;
    } else if (g.autoSaveAmount != null) {
      const add = Math.min(g.autoSaveAmount, incomingAmount);
      g.currentAmount = Math.min(g.targetAmount, g.currentAmount + add);
      if (g.currentAmount >= g.targetAmount) g.completed = true;
    }
  }
}
