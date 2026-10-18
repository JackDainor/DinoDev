import { sql } from '@/lib/db';
import { ensureSchema } from '@/lib/schema';

export type Margins = {
  gamesPct: number;
  pinsPct: number;
  enabledBigCategories: number[]; // empty = all enabled
};

export async function getMargins(): Promise<Margins> {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT key, value FROM app_settings WHERE key IN ('margin_games_pct', 'margin_pins_pct', 'enabled_big_categories')`;
  const map: Record<string, string> = {};
  for (const r of rows as any[]) map[r.key] = r.value;

  let enabled: number[] = [];
  try {
    enabled = JSON.parse(map.enabled_big_categories || '[]');
    if (!Array.isArray(enabled)) enabled = [];
  } catch {
    enabled = [];
  }

  return {
    gamesPct: Math.max(0, Number(map.margin_games_pct ?? 20) || 20),
    pinsPct: Math.max(0, Number(map.margin_pins_pct ?? 10) || 10),
    enabledBigCategories: enabled.map(Number).filter((n) => !Number.isNaN(n)),
  };
}

export async function setMargins(input: {
  gamesPct?: number;
  pinsPct?: number;
  enabledBigCategories?: number[];
}) {
  await ensureSchema();
  const db = sql();
  if (input.gamesPct != null) {
    await db`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('margin_games_pct', ${String(input.gamesPct)}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${String(input.gamesPct)}, updated_at = now()
    `;
  }
  if (input.pinsPct != null) {
    await db`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('margin_pins_pct', ${String(input.pinsPct)}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${String(input.pinsPct)}, updated_at = now()
    `;
  }
  if (input.enabledBigCategories != null) {
    const v = JSON.stringify(input.enabledBigCategories);
    await db`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('enabled_big_categories', ${v}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${v}, updated_at = now()
    `;
  }
}

/** Heuristic: gift cards / pins / razer vs game topups */
export function isPinCategory(name: string, bigName?: string): boolean {
  const s = `${name} ${bigName || ''}`.toLowerCase();
  return /razer|gold|pin|gift|card|voucher|steam|google\s*play|itunes|netflix|xbox|playstation|psn|nintendo/.test(s);
}

export function applyMargin(costUsd: number, marginPct: number): number {
  const p = costUsd * (1 + marginPct / 100);
  return Math.round(p * 10000) / 10000; // 4 decimals
}
