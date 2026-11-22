"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { btnPrimary, inputCls } from "@/lib/ui";

type StockRow = { id: number; name: string; unit: string; available: string; expired: string };
type OpnameRow = {
  id: number;
  note: string | null;
  created_at: string;
  user_name: string;
  item_count: number;
  diff_count: number;
};
type OpnameItem = { ingredient_id: number; ingredient: string; unit: string; system_qty: string; counted_qty: string; diff: string };
type OpnameDetail = { id: number; items: OpnameItem[] };

function DiffText({ diff, unit }: { diff: string; unit: string }) {
  const n = Number(diff);
  if (n === 0) return <span className="text-muted">sama</span>;
  return (
    <span className={`font-medium tabular-nums ${n < 0 ? "text-danger" : "text-ink"}`}>
      {n > 0 ? "+" : ""}
      {fmtQty(n)} {unit}
    </span>
  );
}

function OpnameView() {
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [history, setHistory] = useState<OpnameRow[] | null>(null);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<OpnameDetail | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api<StockRow[]>("/stock"), api<OpnameRow[]>("/opnames")]);
      setStock(s);
      setHistory(h);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch awal, setState terjadi setelah await
    load();
  }, [load]);

  // stok menurut sistem = semua batch yang masih ada sisa, termasuk yang sudah kedaluwarsa (hanya tampilan)
  const systemQty = (r: StockRow) => Number(r.available) + Number(r.expired);
  const filled = Object.entries(counts).filter(([, v]) => v !== "");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (filled.length === 0) {
      setError("Isi hasil hitung fisik minimal untuk satu bahan.");
      return;
    }
    if (filled.some(([, v]) => !(Number(v) >= 0))) {
      setError("Hasil hitung tidak boleh negatif.");
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ id: number; items: OpnameItem[] }>("/opnames", {
        method: "POST",
        body: JSON.stringify({
          note: note || undefined,
          items: filled.map(([id, v]) => ({ ingredient_id: Number(id), counted_qty: Number(v) })),
        }),
      });
      const diffs = res.items.filter((i) => Number(i.diff) !== 0).length;
      setMessage(`Opname #${res.id} tersimpan, ${diffs} bahan berselisih.`);
      setCounts({});
      setNote("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(id: number) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      setDetail(await api<OpnameDetail>(`/opnames/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mb-6 rounded-md border border-line bg-white p-4">
        <h2 className="mb-1 font-display text-lg font-semibold tracking-tight text-ink">Hitung fisik</h2>
        <p className="mb-3 text-sm text-muted">Isi hanya bahan yang kamu hitung. Selisih langsung menyesuaikan stok dan tercatat di buku besar.</p>

        {stock === null && !error && (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 size={16} className="animate-spin" /> Memuat stok...
          </p>
        )}
        {stock?.length === 0 && <p className="text-muted">Belum ada bahan.</p>}
        {stock && stock.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
            {stock.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{r.name}</p>
                  <p className="text-sm text-muted">Menurut sistem {fmtQty(systemQty(r))} {r.unit}</p>
                </div>
                <input
                  aria-label={`Hasil hitung ${r.name}`}
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Hasil hitung"
                  value={counts[r.id] ?? ""}
                  onChange={(e) => setCounts((c) => ({ ...c, [r.id]: e.target.value }))}
                  className={`w-36 ${inputCls}`}
                />
                <span className="w-10 text-sm text-muted">{r.unit}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-sm text-muted" htmlFor="o-note">Catatan</label>
            <input id="o-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={`w-full ${inputCls}`} />
          </div>
          <button type="submit" disabled={saving || filled.length === 0} className={btnPrimary}>
            {saving && <Loader2 size={16} className="animate-spin" />}
            Simpan opname{filled.length > 0 ? ` (${filled.length})` : ""}
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-danger">{error}</p>}
        {message && (
          <p role="status" className="mt-3 inline-flex items-center gap-1 rounded-sm bg-highlight px-2 py-0.5 text-sm font-medium text-ink">
            <Check size={14} /> {message}
          </p>
        )}
      </form>

      <h2 className="mb-2 font-display text-lg font-semibold tracking-tight text-ink">Riwayat opname</h2>
      {history?.length === 0 && (
        <p className="rounded-md border-2 border-dashed border-line bg-white py-8 text-center text-muted">Belum ada opname.</p>
      )}
      {history && history.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {history.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => toggle(o.id)} aria-expanded={openId === o.id} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-paper">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">Opname #{o.id}</p>
                  <p className="text-sm text-muted">
                    {fmtDateTime(o.created_at)} · {o.user_name}
                    {o.note ? ` · ${o.note}` : ""}
                  </p>
                </div>
                <span className="text-sm text-muted">
                  {o.item_count} bahan,{" "}
                  <span className={o.diff_count > 0 ? "font-medium text-ink" : ""}>{o.diff_count} berselisih</span>
                </span>
                <ChevronDown size={16} className={`text-muted transition-transform ${openId === o.id ? "rotate-180" : ""}`} />
              </button>
              {openId === o.id && (
                <div className="border-t border-line bg-paper px-4 py-3">
                  {!detail || detail.id !== o.id ? (
                    <Loader2 size={16} className="animate-spin text-muted" />
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {detail.items.map((it) => (
                        <li key={it.ingredient_id} className="flex flex-wrap justify-between gap-3">
                          <span className="text-ink">{it.ingredient}</span>
                          <span className="tabular-nums text-muted">
                            sistem {fmtQty(it.system_qty)} → hitung {fmtQty(it.counted_qty)} {it.unit} · <DiffText diff={it.diff} unit={it.unit} />
                          </span>
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
    </>
  );
}

export default function OpnamesPage() {
  return (
    <AppShell title="Stock opname" description="Cocokkan hasil hitung fisik dengan catatan sistem." roles={["admin", "store_keeper"]}>
      <OpnameView />
    </AppShell>
  );
}