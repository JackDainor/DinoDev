import { sql } from '@/lib/db';

/** Ensure all tables exist (safe to call on every request). */
export async function ensureSchema() {
  const db = sql();

  await db`
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'reseller',
      balance_usd numeric NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS app_settings (
      key text PRIMARY KEY,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS reseller_orders (
      id uuid PRIMARY KEY,
      reseller_id uuid NOT NULL REFERENCES app_users(id),
      status text NOT NULL DEFAULT 'pending',
      game_name text NOT NULL,
      item_name text NOT NULL,
      item_id integer NOT NULL,
      category_id integer NOT NULL,
      region_label text,
      player_id text NOT NULL,
      player_name text,
      cost_usd numeric NOT NULL,
      price_usd numeric NOT NULL,
      margin_pct numeric NOT NULL,
      provider_response jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS balance_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id),
      amount_usd numeric NOT NULL,
      kind text NOT NULL,
      note text,
      admin_note text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Defaults for margins if missing
  const rows = await db`SELECT key FROM app_settings WHERE key IN ('margin_games_pct', 'margin_pins_pct', 'enabled_big_categories')`;
  const keys = new Set(rows.map((r: any) => r.key));
  if (!keys.has('margin_games_pct')) {
    await db`INSERT INTO app_settings (key, value) VALUES ('margin_games_pct', '20') ON CONFLICT (key) DO NOTHING`;
  }
  if (!keys.has('margin_pins_pct')) {
    await db`INSERT INTO app_settings (key, value) VALUES ('margin_pins_pct', '10') ON CONFLICT (key) DO NOTHING`;
  }
  if (!keys.has('enabled_big_categories')) {
    // empty = all; JSON array of big_category ids when restricted
    await db`INSERT INTO app_settings (key, value) VALUES ('enabled_big_categories', '[]') ON CONFLICT (key) DO NOTHING`;
  }
}
