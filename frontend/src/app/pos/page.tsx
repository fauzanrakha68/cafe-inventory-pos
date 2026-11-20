"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, ChevronDown, Loader2, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api, getUser } from "@/lib/api";
import { fmtDateTime, fmtRp } from "@/lib/format";
import { btnPrimary, iconBtn } from "@/lib/ui";

type Menu = { id: number; name: string; price: number; active: boolean };
type CartLine = { menu: Menu; qty: number };
type SaleRow = { id: number; total: number; created_at: string; cashier: string };
type SaleDetail = SaleRow & { items: { menu_id: number; name: string; qty: number; unit_price: number }[] };

const MAX_QTY = 99;

function Register({ onSold }: { onSold: () => void }) {
  const [menus, setMenus] = useState<Menu[] | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    api<Menu[]>("/menus")
      .then((m) => setMenus(m.filter((x) => x.active)))
      .catch((e) => setLoadError((e as Error).message));
  }, []);

  const total = cart.reduce((s, l) => s + l.menu.price * l.qty, 0);
  const count = cart.reduce((s, l) => s + l.qty, 0);

  function add(menu: Menu) {
    setMessage("");
    setError("");
    setCart((c) => {
      const found = c.find((l) => l.menu.id === menu.id);
      if (!found) return [...c, { menu, qty: 1 }];
      return c.map((l) => (l.menu.id === menu.id ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l));
    });
  }

  function change(id: number, delta: number) {
    setError("");
    setCart((c) =>
      c.map((l) => (l.menu.id === id ? { ...l, qty: Math.min(MAX_QTY, l.qty + delta) } : l)).filter((l) => l.qty > 0)
    );
  }

  async function pay() {
    setError("");
    setMessage("");
    setPaying(true);
    try {
      const sale = await api<{ id: number; total: number }>("/sales", {
        method: "POST",
        body: JSON.stringify({ items: cart.map((l) => ({ menu_id: l.menu.id, qty: l.qty })) }),
      });
      setCart([]);
      setMessage(`Penjualan #${sale.id} tersimpan, total ${fmtRp(sale.total)}.`);
      onSold();
    } catch (err) {
      // 409 "Stok X tidak cukup": keranjang dibiarkan supaya kasir bisa mengurangi jumlahnya
      setError((err as Error).message);
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-label="Daftar menu">
        {loadError && <p role="alert" className="text-sm font-medium text-danger">{loadError}</p>}
        {menus === null && !loadError && (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 size={16} className="animate-spin" /> Memuat menu...
          </p>
        )}
        {menus?.length === 0 && (
          <p className="rounded-md border-2 border-dashed border-line bg-white py-10 text-center text-muted">
            Belum ada menu aktif. Minta admin menambahkan menu dulu.
          </p>
        )}
        {menus && menus.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {menus.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => add(m)}
                  className="flex h-full w-full flex-col items-start justify-between gap-3 rounded-md border border-line bg-white p-4 text-left hover:border-ink hover:bg-paper"
                >
                  <span className="font-medium text-ink">{m.name}</span>
                  <span className="flex w-full items-center justify-between">
                    <span className="font-semibold tabular-nums text-ink">{fmtRp(m.price)}</span>
                    <span className="rounded-full bg-highlight p-1 text-ink"><Plus size={14} /></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside aria-label="Keranjang" className="h-fit rounded-md border border-line bg-white p-4 lg:sticky lg:top-20">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-ink">
          <ShoppingCart size={18} /> Keranjang
          {count > 0 && <span className="rounded-full bg-highlight px-2 text-sm">{count}</span>}
        </h2>

        {cart.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Pilih menu di sebelah kiri.</p>
        ) : (
          <ul className="divide-y divide-line">
            {cart.map((l) => (
              <li key={l.menu.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{l.menu.name}</p>
                  <p className="text-xs tabular-nums text-muted">{fmtRp(l.menu.price)}</p>
                </div>
                <button type="button" aria-label={`Kurangi ${l.menu.name}`} className={iconBtn} onClick={() => change(l.menu.id, -1)}>
                  {l.qty === 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                </button>
                <span className="w-6 text-center text-sm font-semibold tabular-nums">{l.qty}</span>
                <button
                  type="button"
                  aria-label={`Tambah ${l.menu.name}`}
                  disabled={l.qty >= MAX_QTY}
                  className={iconBtn}
                  onClick={() => change(l.menu.id, 1)}
                >
                  <Plus size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className="text-sm text-muted">Total</span>
          <span className="font-display text-xl font-semibold tabular-nums text-ink">{fmtRp(total)}</span>
        </div>

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 text-sm font-medium text-danger">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
        {message && (
          <p role="status" className="mt-3 flex items-start gap-2 rounded-sm bg-highlight px-2 py-1 text-sm font-medium text-ink">
            <Check size={16} className="mt-0.5 shrink-0" /> {message}
          </p>
        )}

        <button type="button" onClick={pay} disabled={cart.length === 0 || paying} className={`mt-4 w-full ${btnPrimary}`}>
          {paying && <Loader2 size={16} className="animate-spin" />}
          Bayar
        </button>
        {cart.length > 0 && (
          <button type="button" onClick={() => setCart([])} className="mt-2 w-full text-center text-sm text-muted hover:text-ink">
            Kosongkan keranjang
          </button>
        )}
      </aside>
    </div>
  );
}

function History({ version }: { version: number }) {
  const isAdmin = getUser()?.role === "admin";
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<SaleRow[]>("/sales"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  async function toggle(id: number) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      setDetail(await api<SaleDetail>(`/sales/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-2 font-display text-lg font-semibold tracking-tight text-ink">
        {isAdmin ? "Riwayat penjualan" : "Riwayat penjualanmu"}
      </h2>
      {error && <p role="alert" className="mb-2 text-sm font-medium text-danger">{error}</p>}
      {rows?.length === 0 && (
        <p className="rounded-md border-2 border-dashed border-line bg-white py-8 text-center text-muted">Belum ada penjualan.</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {rows.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => toggle(s.id)} aria-expanded={openId === s.id} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">Penjualan #{s.id}</p>
                  <p className="text-sm text-muted">{fmtDateTime(s.created_at)}{isAdmin ? ` · ${s.cashier}` : ""}</p>
                </div>
                <span className="font-semibold tabular-nums text-ink">{fmtRp(s.total)}</span>
                <ChevronDown size={16} className={`text-muted transition-transform ${openId === s.id ? "rotate-180" : ""}`} />
              </button>
              {openId === s.id && (
                <div className="border-t border-line bg-paper px-4 py-3">
                  {!detail || detail.id !== s.id ? (
                    <Loader2 size={16} className="animate-spin text-muted" />
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {detail.items.map((it) => (
                        <li key={it.menu_id} className="flex justify-between gap-3">
                          <span className="text-ink">{it.qty} × {it.name}</span>
                          <span className="tabular-nums text-muted">{fmtRp(it.qty * it.unit_price)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PosView() {
  const [version, setVersion] = useState(0);
  return (
    <>
      <Register onSold={() => setVersion((v) => v + 1)} />
      <History version={version} />
    </>
  );
}

export default function PosPage() {
  return (
    <AppShell title="Kasir" description="Pilih menu, lalu bayar. Stok bahan terpotong otomatis sesuai resep." roles={["kasir", "admin"]}>
      <PosView />
    </AppShell>
  );
}