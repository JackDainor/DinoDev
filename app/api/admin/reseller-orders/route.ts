import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { ensureSchema } from '@/lib/schema';
import { s2t, safeError } from '@/lib/shop2topup';

function authed(req: NextRequest) {
  const secret = process.env.OPERATOR_SECRET || '';
  if (!secret) return false;
  return (req.headers.get('x-admin-secret') || '') === secret;
}

export async function GET(req: NextRequest) {
  try {
    if (!authed(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    await ensureSchema();
    const db = sql();
    const rows = await db`
      SELECT o.id, o.status, o.game_name, o.item_name, o.player_id, o.player_name,
             o.cost_usd::text, o.price_usd::text, o.margin_pct::text,
             o.created_at, o.updated_at,
             u.username, u.email
      FROM reseller_orders o
      JOIN app_users u ON u.id = o.reseller_id
      ORDER BY o.created_at DESC
      LIMIT 100
    `;
    return NextResponse.json({ success: true, orders: rows });
  } catch (e) {
    const x = safeError(e);
    return NextResponse.json(x, { status: x.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!authed(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    await ensureSchema();
    const b = await req.json();
    const id = String(b.id || '');
    const action = String(b.action || 'fulfill');
    const db = sql();

    const rows = await db`SELECT * FROM reseller_orders WHERE id = ${id}::uuid LIMIT 1`;
    const row = rows[0];
    if (!row) return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });

    if (action === 'reject') {
      if (row.status === 'completed') {
        return NextResponse.json({ error: 'Ya estaba completada' }, { status: 400 });
      }
      // refund balance
      if (row.status === 'pending') {
        await db`
          UPDATE app_users SET balance_usd = balance_usd + ${Number(row.price_usd)}, updated_at = now()
          WHERE id = ${row.reseller_id}::uuid
        `;
        await db`
          INSERT INTO balance_ledger (user_id, amount_usd, kind, note)
          VALUES (${row.reseller_id}::uuid, ${Number(row.price_usd)}, 'refund', ${'Reembolso orden ' + id})
        `;
      }
      await db`UPDATE reseller_orders SET status = 'rejected', updated_at = now() WHERE id = ${id}::uuid`;
      return NextResponse.json({ success: true, status: 'rejected' });
    }

    if (action === 'fulfill') {
      if (row.status === 'completed') {
        return NextResponse.json({ success: true, status: 'completed', message: 'Ya completada' });
      }
      if (row.status === 'rejected') {
        return NextResponse.json({ error: 'Orden rechazada' }, { status: 400 });
      }

      const out = await s2t('/orders/create', {
        method: 'POST',
        body: JSON.stringify({
          order_id: id,
          sub_category_id: Number(row.item_id),
          quantity: 1,
          requirements: { player_id: row.player_id },
          expected_unit_price: String(row.cost_usd),
        }),
      });

      const providerStatus = String(out.order?.status ?? out.status ?? '').toLowerCase();
      const failed = /fail|error|cancel|reject/i.test(providerStatus);
      const finalStatus = failed ? 'failed' : 'completed';

      await db`
        UPDATE reseller_orders SET
          status = ${finalStatus},
          provider_response = ${JSON.stringify(out)}::jsonb,
          updated_at = now()
        WHERE id = ${id}::uuid
      `;

      // if failed after charge, refund
      if (failed) {
        await db`
          UPDATE app_users SET balance_usd = balance_usd + ${Number(row.price_usd)}, updated_at = now()
          WHERE id = ${row.reseller_id}::uuid
        `;
        await db`
          INSERT INTO balance_ledger (user_id, amount_usd, kind, note)
          VALUES (${row.reseller_id}::uuid, ${Number(row.price_usd)}, 'refund', ${'Fallo envío ' + id})
        `;
      }

      return NextResponse.json({
        success: true,
        status: finalStatus,
        provider: out,
        message: finalStatus === 'completed' ? 'Enviado y completado.' : 'Falló el proveedor; saldo reembolsado.',
      });
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  } catch (e) {
    const x = safeError(e);
    return NextResponse.json(x, { status: x.status || 500 });
  }
}
