import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionUser, requireReseller } from '@/lib/auth';
import { sql } from '@/lib/db';
import { ensureSchema } from '@/lib/schema';
import { getMargins, isPinCategory, applyMargin } from '@/lib/pricing';
import { s2t, safeError } from '@/lib/shop2topup';

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!requireReseller(user)) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }
    await ensureSchema();
    const db = sql();
    const rows = await db`
      SELECT id, status, game_name, item_name, player_id, player_name,
             cost_usd::text, price_usd::text, margin_pct::text, created_at, updated_at
      FROM reseller_orders
      WHERE reseller_id = ${user!.id}::uuid
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ success: true, orders: rows, balance_usd: user!.balance_usd });
  } catch (e) {
    const x = safeError(e);
    return NextResponse.json(x, { status: x.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!requireReseller(user)) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }
    await ensureSchema();
    const b = await req.json();
    const itemId = Number(b.itemId);
    const categoryId = Number(b.categoryId);
    const playerId = String(b.playerId || '').trim();
    const gameName = String(b.gameName || 'Producto');
    const itemName = String(b.itemName || 'Item');
    const regionLabel = String(b.regionLabel || '');

    if (!itemId || !categoryId || !playerId) {
      return NextResponse.json({ error: 'Faltan itemId, categoryId o playerId.' }, { status: 400 });
    }

    // Live price from provider
    let cost = Number(b.costUsd || 0);
    try {
      const priceBody = await s2t(`/catalog/subcategory/${itemId}/price`);
      const p = priceBody.price ?? priceBody.data?.price ?? priceBody.unit_price;
      if (p != null) cost = Number(p);
    } catch { /* use client cost if any */ }

    if (!(cost > 0)) {
      return NextResponse.json({ error: 'No se pudo obtener el precio del producto.' }, { status: 400 });
    }

    const margins = await getMargins();
    const pin = isPinCategory(gameName + ' ' + itemName);
    const pct = pin ? margins.pinsPct : margins.gamesPct;
    const price = applyMargin(cost, pct);

    const db = sql();
    // Lock-style: check balance then deduct
    const balRows = await db`SELECT balance_usd::text FROM app_users WHERE id = ${user!.id}::uuid FOR UPDATE`;
    // neon serverless may not support FOR UPDATE the same way - fallback
    const balance = Number((balRows[0] || user).balance_usd);
    if (balance < price) {
      return NextResponse.json(
        { error: `Saldo insuficiente. Tienes ${balance.toFixed(4)} USD, el pack cuesta ${price.toFixed(4)} USD.` },
        { status: 402 }
      );
    }

    // Optional validate player
    let playerName = '';
    try {
      const val = await s2t('/player/validate', {
        method: 'POST',
        body: JSON.stringify({
          item_id: itemId,
          category_id: categoryId,
          player_id: playerId,
        }),
      });
      playerName = val.player_name || val.data?.player_name || val.player?.player_name || '';
    } catch (err: any) {
      // allow voucher-style without player validate failure soft
      if (!/voucher|pin|gold/i.test(gameName + itemName)) {
        return NextResponse.json(
          { error: err?.message || 'No se pudo validar el ID del jugador.' },
          { status: 400 }
        );
      }
    }

    const id = randomUUID();
    await db`
      UPDATE app_users SET balance_usd = balance_usd - ${price}, updated_at = now()
      WHERE id = ${user!.id}::uuid AND balance_usd >= ${price}
    `;
    // verify deduct happened
    const after = await db`SELECT balance_usd::text FROM app_users WHERE id = ${user!.id}::uuid`;
    if (Number(after[0]?.balance_usd) > balance - price + 0.0001 && Number(after[0]?.balance_usd) === balance) {
      // deduct might have failed
      const still = Number(after[0]?.balance_usd);
      if (still >= balance) {
        return NextResponse.json({ error: 'No se pudo descontar el saldo. Reintenta.' }, { status: 409 });
      }
    }

    await db`
      INSERT INTO reseller_orders (
        id, reseller_id, status, game_name, item_name, item_id, category_id,
        region_label, player_id, player_name, cost_usd, price_usd, margin_pct
      ) VALUES (
        ${id}::uuid, ${user!.id}::uuid, 'pending', ${gameName}, ${itemName}, ${itemId}, ${categoryId},
        ${regionLabel}, ${playerId}, ${playerName || null}, ${cost}, ${price}, ${pct}
      )
    `;
    await db`
      INSERT INTO balance_ledger (user_id, amount_usd, kind, note)
      VALUES (${user!.id}::uuid, ${-price}, 'order', ${'Pedido ' + id})
    `;

    return NextResponse.json({
      success: true,
      order: {
        id,
        status: 'pending',
        price_usd: price,
        player_name: playerName,
      },
      balance_usd: after[0]?.balance_usd,
    });
  } catch (e) {
    const x = safeError(e);
    return NextResponse.json(x, { status: x.status || 500 });
  }
}
