"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { fmtDate, fmtQty } from "@/lib/format";
import { btnPrimary, inputCls } from "@/lib/ui";

type StockRow = {
  id: number;
  name: string;
  unit: string;
  min_stock: string;
  available: string;
  expired: string;
  nearest_expiry: string | null;
  is_low: boolean;
};

const emptyForm = { ingredient_id: "", quantity: "", unit_cost: "", expires_at: "" };

function StockView() {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const selected = rows?.find((r) => String(r.id) === form.ingredient_id);

  const load = useCallback(async () => {
    try {
      setRows(await api<StockRow[]>("/stock"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch awal, setState terjadi setelah await
    load();
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await api("/stock/receive", {
        method: "POST",
        body: JSON.stringify({
          items: [
            {
              ingredient_id: Number(form.ingredient_id),
              quantity: Number(form.quantity),
              unit_cost: Number(form.unit_cost),
              expires_at: form.expires_at,
            },
          ],
        }),
      });
      setForm(emptyForm);
      setMessage("Penerimaan barang tersimpan.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mb-6 rounded-md border border-line bg-white p-4">
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-ink">Terima barang</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-sm text-muted" htmlFor="ing">Bahan</label>
            <select id="ing" required value={form.ingredient_id} onChange={(e) => setForm({ ...form, ingredient_id: e.target.value })} className={`w-full ${inputCls}`}>
              <option value="">Pilih bahan</option>
              {rows?.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="qty">Jumlah{selected ? ` (${selected.unit})` : ""}</label>
            <input id="qty" type="number" min="0" step="any" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={`w-32 ${inputCls}`} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="cost">Harga beli per satuan (Rp)</label>
            <input id="cost" type="number" min="0" step="1" required value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} className={`w-44 ${inputCls}`} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="exp">Kedaluwarsa</label>
            <input id="exp" type="date" min={today} required value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} className={inputCls} />
          </div>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving && <Loader2 size={16} className="animate-spin" />}
            Simpan
          </button>
        </div>
        {message && (
          <p role="status" className="mt-3 inline-flex items-center gap-1 rounded-sm bg-highlight px-2 py-0.5 text-sm font-medium text-ink">
            <Check size={14} /> {message}
          </p>
        )}
      </form>

      {error && <p role="alert" className="mb-4 text-sm font-medium text-danger">{error}</p>}
      {rows === null && !error && (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Memuat stok...
        </p>
      )}
      {rows?.length === 0 && (
        <p className="rounded-md border-2 border-dashed border-line bg-white py-10 text-center text-muted">
          Belum ada bahan. Tambahkan dulu di halaman Bahan.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-paper">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{r.name}</p>
                <p className="text-sm text-muted">
                  {r.nearest_expiry ? `Kedaluwarsa terdekat ${fmtDate(r.nearest_expiry)}` : "Belum ada batch"}
                </p>
                {Number(r.expired) > 0 && (
                  <p className="text-sm font-medium text-danger">{fmtQty(r.expired)} {r.unit} sudah kedaluwarsa</p>
                )}
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums text-ink">{fmtQty(r.available)} {r.unit}</p>
                <p className="text-xs text-muted">minimum {fmtQty(r.min_stock)}</p>
              </div>
              {r.is_low ? (
                <span className="inline-flex w-24 items-center justify-center gap-1 rounded-sm bg-highlight px-2 py-0.5 text-sm font-medium text-ink">
                  <AlertCircle size={14} /> Menipis
                </span>
              ) : (
                <span className="inline-flex w-24 items-center justify-center gap-1 text-sm text-muted">
                  <Check size={14} /> Aman
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function StockPage() {
  return (
    <AppShell title="Stok" description="Stok tersedia per bahan, tidak termasuk batch yang sudah kedaluwarsa." roles={["admin", "store_keeper"]}>
      <StockView />
    </AppShell>
  );
}