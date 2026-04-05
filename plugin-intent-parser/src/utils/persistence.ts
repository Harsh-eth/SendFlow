import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

function getDataRoot(): string {
  return process.env.SENDFLOW_DATA_DIR?.trim() || join(process.cwd(), "data");
}

export function persistLoad<T>(filename: string, defaultValue: T): T {
  const filePath = join(getDataRoot(), filename);
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8")) as T;
    }
  } catch (err) {
    console.warn(`Failed to load ${filename}:`, err);
  }
  return defaultValue;
}

export function persistSave(filename: string, data: unknown): void {
  const root = getDataRoot();
  const filePath = join(root, filename);
  mkdirSync(root, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function persistLoadMap<K extends string, V>(filename: string): Map<K, V> {
  const obj = persistLoad<Record<K, V>>(filename, {} as Record<K, V>);
  return new Map(Object.entries(obj) as [K, V][]);
}

export function persistSaveMap<K extends string, V>(filename: string, map: Map<K, V>): void {
  persistSave(filename, Object.fromEntries(map));
}
