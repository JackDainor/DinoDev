import { NextRequest, NextResponse } from 'next/server';
import { getMargins, setMargins } from '@/lib/pricing';
import { s2t, safeError } from '@/lib/shop2topup';

function authed(req: NextRequest) {
  const secret = process.env.OPERATOR_SECRET || '';
  if (!secret) return false;
  return (req.headers.get('x-admin-secret') || '') === secret;
}

export async function GET(req: NextRequest) {
  try {
    if (!authed(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const margins = await getMargins();
    let bigCategories: any[] = [];
    try {
      const body = await s2t('/catalog/big-categories?for_ui=true');
      const list = body.big_categories || body.data || body.categories || [];
      bigCategories = Array.isArray(list) ? list : [];
    } catch {
      bigCategories = [];
    }
    return NextResponse.json({ success: true, margins, bigCategories });
  } catch (e) {
    const x = safeError(e);
    return NextResponse.json(x, { status: x.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!authed(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const b = await req.json();
    await setMargins({
      gamesPct: b.gamesPct != null ? Number(b.gamesPct) : undefined,
      pinsPct: b.pinsPct != null ? Number(b.pinsPct) : undefined,
      enabledBigCategories: Array.isArray(b.enabledBigCategories)
        ? b.enabledBigCategories.map(Number)
        : undefined,
    });
    const margins = await getMargins();
    return NextResponse.json({ success: true, margins });
  } catch (e) {
    const x = safeError(e);
    return NextResponse.json(x, { status: x.status || 500 });
  }
}
