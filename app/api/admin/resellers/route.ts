import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { ensureSchema } from '@/lib/schema';
import { hashPassword } from '@/lib/auth';
import { safeError } from '@/lib/shop2topup';

function authed(req: NextRequest) {
  const secret = process.env.OPERATOR_SECRET || '';
  if (!secret) return false;
  const h = req.headers.get('x-admin-secret') || '';
  const q = req.nextUrl.searchParams.get('secret') || '';
  return h === secret || q === secret;
}

export async function GET(req: NextRequest) {
  try {
    if (!authed(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    await ensureSchema();
    const db = sql();
    const rows = await db`
      SELECT id, email, username, role, balance_usd::text, active, created_at
      FROM app_users WHERE role = 'reseller'
      ORDER BY created_at DESC
    `;
    return NextResponse.json({ success: true, resellers: rows });
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
    const action = String(b.action || 'create');
    const db = sql();

    if (action === 'create') {
      const email = String(b.email || '').trim().toLowerCase();
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      if (!email || !username || password.length < 6) {
        return NextResponse.json({ error: 'Email, username y contraseña (mín. 6) requeridos.' }, { status: 400 });
      }
      const password_hash = hashPassword(password);
      try {
        const rows = await db`
          INSERT INTO app_users (email, username, password_hash, role, balance_usd)
          VALUES (${email}, ${username}, ${password_hash}, 'reseller', 0)
          RETURNING id, email, username, balance_usd::text, active
        `;
        return NextResponse.json({ success: true, reseller: rows[0] });
      } catch (err: any) {
        if (String(err?.message || '').includes('unique')) {
          return NextResponse.json({ error: 'Email o username ya existe.' }, { status: 409 });
        }
        throw err;
      }
    }

    if (action === 'credit') {
      const id = String(b.id || '');
      const amount = Number(b.amount);
      const note = String(b.note || 'Acreditación admin');
      if (!id || !(amount > 0)) {
        return NextResponse.json({ error: 'ID y monto > 0 requeridos.' }, { status: 400 });
      }
      await db`
        UPDATE app_users SET balance_usd = balance_usd + ${amount}, updated_at = now()
        WHERE id = ${id}::uuid AND role = 'reseller'
      `;
      await db`
        INSERT INTO balance_ledger (user_id, amount_usd, kind, note, admin_note)
        VALUES (${id}::uuid, ${amount}, 'credit', ${note}, ${note})
      `;
      const rows = await db`SELECT id, balance_usd::text FROM app_users WHERE id = ${id}::uuid`;
      return NextResponse.json({ success: true, reseller: rows[0] });
    }

    if (action === 'set_active') {
      const id = String(b.id || '');
      const active = Boolean(b.active);
      await db`UPDATE app_users SET active = ${active}, updated_at = now() WHERE id = ${id}::uuid`;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  } catch (e) {
    const x = safeError(e);
    return NextResponse.json(x, { status: x.status || 500 });
  }
}
