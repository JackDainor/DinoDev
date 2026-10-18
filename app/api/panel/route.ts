import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, requireReseller } from '@/lib/auth';
import { getMargins, isPinCategory, applyMargin } from '@/lib/pricing';
import { s2t, safeError } from '@/lib/shop2topup';

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!requireReseller(user)) {
      return NextResponse.json({ error: 'No autenticado como revendedor.' }, { status: 401 });
    }

    const margins = await getMargins();
    const bigId = req.nextUrl.searchParams.get('bigCategoryId');
    const categoryId = req.nextUrl.searchParams.get('categoryId');

    // List big categories
    if (!bigId) {
      const body = await s2t('/catalog/big-categories?for_ui=true');
      let list: any[] = body.big_categories || body.data || [];
      if (!Array.isArray(list)) list = [];
      if (margins.enabledBigCategories.length > 0) {
        const allow = new Set(margins.enabledBigCategories);
        list = list.filter((c: any) => allow.has(Number(c.id)));
      }
      return NextResponse.json({
        success: true,
        balance_usd: user!.balance_usd,
        margins: { gamesPct: margins.gamesPct, pinsPct: margins.pinsPct },
        bigCategories: list.map((c: any) => ({
          id: c.id,
          name: c.name || c.big_category_name || String(c.id),
        })),
      });
    }

    // Categories under big
    if (bigId && !categoryId) {
      const body = await s2t(`/catalog/categories?bigCategoryId=${bigId}&for_ui=true`);
      let list: any[] = body.categories || body.data || [];
      if (!Array.isArray(list)) list = [];
      return NextResponse.json({
        success: true,
        categories: list.map((c: any) => ({
          id: c.id,
          name: c.name,
          big_category_id: c.big_category_id,
        })),
      });
    }

    // Products (subcategories)
    const body = await s2t(`/catalog/subcategories?categoryId=${categoryId}`);
    let list: any[] = body.subcategories || body.data || [];
    if (!Array.isArray(list)) list = [];

    // Need category name for pin heuristic
    let catName = '';
    let bigName = '';
    try {
      const cats = await s2t(`/catalog/categories?bigCategoryId=${bigId}&for_ui=true`);
      const found = (cats.categories || []).find((c: any) => Number(c.id) === Number(categoryId));
      catName = found?.name || '';
    } catch { /* ignore */ }

    const pin = isPinCategory(catName, bigName);
    const pct = pin ? margins.pinsPct : margins.gamesPct;

    const products = list.map((p: any) => {
      const cost = Number(p.price || p.unit_price || 0);
      const price = applyMargin(cost, pct);
      return {
        id: p.item_id || p.id,
        name: p.name,
        description: p.description || '',
        cost_usd: cost,
        price_usd: price,
        margin_pct: pct,
        category_id: Number(categoryId),
        product_type: p.product_type || (pin ? 'voucher' : 'topup'),
      };
    });

    return NextResponse.json({ success: true, products, margin_pct: pct });
  } catch (e) {
    const x = safeError(e);
    return NextResponse.json(x, { status: x.status || 500 });
  }
}
