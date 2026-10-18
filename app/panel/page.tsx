'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type BigCat = { id: number; name: string };
type Cat = { id: number; name: string };
type Product = {
  id: number;
  name: string;
  price_usd: number;
  cost_usd: number;
  margin_pct: number;
  category_id: number;
};
type Order = {
  id: string;
  status: string;
  game_name: string;
  item_name: string;
  player_id: string;
  player_name?: string;
  price_usd: string;
  created_at: string;
};

export default function PanelPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [balance, setBalance] = useState('0');
  const [bigCats, setBigCats] = useState<BigCat[]>([]);
  const [bigId, setBigId] = useState<number | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [catId, setCatId] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const r = await fetch('/api/auth/me');
    if (!r.ok) {
      router.push('/login');
      return null;
    }
    const d = await r.json();
    setUsername(d.user.username);
    setBalance(d.user.balance_usd);
    return d.user;
  }, [router]);

  const loadBig = useCallback(async () => {
    const r = await fetch('/api/panel/catalog');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error catálogo');
    setBigCats(d.bigCategories || []);
    if (d.balance_usd != null) setBalance(d.balance_usd);
  }, []);

  const loadOrders = useCallback(async () => {
    const r = await fetch('/api/panel/orders');
    const d = await r.json();
    if (r.ok) {
      setOrders(d.orders || []);
      if (d.balance_usd != null) setBalance(d.balance_usd);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadMe();
        await loadBig();
        await loadOrders();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadMe, loadBig, loadOrders]);

  async function pickBig(id: number) {
    setBigId(id);
    setCatId(null);
    setProducts([]);
    setSelected(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/panel/catalog?bigCategoryId=${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCats(d.categories || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickCat(id: number) {
    setCatId(id);
    setSelected(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/panel/catalog?bigCategoryId=${bigId}&categoryId=${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setProducts(d.products || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder() {
    if (!selected || !playerId.trim()) {
      setError('Elige producto e ID de jugador.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const catName = cats.find((c) => c.id === catId)?.name || '';
      const bigName = bigCats.find((c) => c.id === bigId)?.name || '';
      const r = await fetch('/api/panel/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: selected.id,
          categoryId: selected.category_id,
          playerId: playerId.trim(),
          gameName: bigName || catName || 'Juego',
          itemName: selected.name,
          costUsd: selected.cost_usd,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo crear el pedido');
      setNotice(`Pedido creado. Jugador: ${d.order?.player_name || playerId}. Pendiente de envío.`);
      setPlayerId('');
      if (d.balance_usd != null) setBalance(d.balance_usd);
      await loadOrders();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  if (loading) {
    return (
      <main className="panel-wrap">
        <p className="muted">Cargando panel…</p>
      </main>
    );
  }

  return (
    <main className="panel-wrap">
      <header className="panel-head">
        <div>
          <strong>Hola, {username}</strong>
          <div className="panel-balance">
            Saldo: <b>{Number(balance).toFixed(4)} USD</b>
          </div>
        </div>
        <button type="button" className="btn" onClick={logout}>
          Salir
        </button>
      </header>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <section className="panel-section">
        <h2>1. Categoría</h2>
        <div className="chip-row">
          {bigCats.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip ${bigId === c.id ? 'active' : ''}`}
              onClick={() => pickBig(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </section>

      {cats.length > 0 && (
        <section className="panel-section">
          <h2>2. Subcategoría / región</h2>
          <div className="chip-row">
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip ${catId === c.id ? 'active' : ''}`}
                onClick={() => pickCat(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {products.length > 0 && (
        <section className="panel-section">
          <h2>3. Producto (precio mayorista USD)</h2>
          <div className="product-grid">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`product-card ${selected?.id === p.id ? 'selected' : ''}`}
                onClick={() => setSelected(p)}
              >
                <span className="product-name">{p.name}</span>
                <span className="price-local">{p.price_usd.toFixed(4)} USD</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {selected && (
        <section className="panel-section panel-box">
          <h2>4. ID del jugador</h2>
          <p className="muted">
            {selected.name} · <strong>{selected.price_usd.toFixed(4)} USD</strong>
          </p>
          <input
            placeholder="Player ID"
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
          />
          <button className="btn primary" type="button" disabled={busy} onClick={placeOrder}>
            {busy ? 'Procesando…' : 'Confirmar pedido (descontar saldo)'}
          </button>
        </section>
      )}

      <section className="panel-section">
        <h2>Mis pedidos</h2>
        <button type="button" className="btn" onClick={() => loadOrders()}>
          Actualizar
        </button>
        <div className="hist-list">
          {orders.length === 0 && <p className="muted">Sin pedidos aún.</p>}
          {orders.map((o) => (
            <div key={o.id} className="hist-item">
              <span className={`st st-${o.status}`}>{o.status}</span>
              <strong>
                {o.game_name} · {o.item_name}
              </strong>
              <small>
                {o.player_name || '—'} ({o.player_id}) · {Number(o.price_usd).toFixed(4)} USD
              </small>
              <small className="mono">{o.id}</small>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
