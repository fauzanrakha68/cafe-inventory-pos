"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { btnPrimary, inputCls } from "@/lib/ui";

type Ingredient = { id: number; name: string; unit: string };
type Batch = { id: number; remaining_qty: string; expires_at: string; is_expired: boolean };
type WasteRow = {
  id: number;
  quantity: string;
  reason: string;
  note: string | null;
  created_at: string;
  ingredient: string;
  unit: string;
  user_name: string;
};

const REASONS = [
  { value: "kedaluwarsa", label: "Kedaluwarsa" },
  { value: "rusak", label: "Rusak" },
  { value: "tumpah", label: "Tumpah" },
  { value: "lainnya", label: "Lainnya" },
];
const reasonLabel = (v: string) => REASONS.find((r) => r.value === v)?.label ?? v;

const emptyForm = { ingredient_id: "", batch_id: "", quantity: "", reason: "kedaluwarsa", note: "" };

function WasteView() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [rows, setRows] = useState<WasteRow[] | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = ingredients.find((i) => String(i.id) === form.ingredient_id);

  const load = useCallback(async () => {
    try {
      const [i, w] = await Promise.all([api<Ingredient[]>("/ingredients"), api<WasteRow[]>("/waste")]);
      setIngredients(i);
      setRows(w);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch awal, setState terjadi setelah await
    load();
  }, [load]);

  async function pickIngredient(id: string) {
    setForm((f) => ({ ...f, ingredient_id: id, batch_id: "" }));
    setBatches([]);
    if (!id) return;
    try {
      setBatches(await api<Batch[]>(`/stock/${id}/batches`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await api("/waste", {
        method: "POST",
        body: JSON.stringify({
          ingredient_id: Number(form.ingredient_id),
          quantity: Number(form.quantity),
          reason: form.reason,
          note: form.note || undefined,
          batch_id: form.batch_id ? Number(form.batch_id) : undefined,
        }),
      });
      setForm(emptyForm);
      setBatches([]);
      setMessage("Pembuangan tercatat, stok berkurang.");
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
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-ink">Catat pembuangan bahan</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-sm text-muted" htmlFor="w-ing">Bahan</label>
            <select id="w-ing" required value={form.ingredient_id} onChange={(e) => pickIngredient(e.target.value)} className={`w-full ${inputCls}`}>
              <option value="">Pilih bahan</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
              ))}
            </select>
          </div>
          <div className="min-w-56 flex-1">
            <label className="mb-1 block text-sm text-muted" htmlFor="w-batch">Batch</label>
            <select id="w-batch" value={form.batch_id} onChange={(e) => setForm({ ...form, batch_id: e.target.value })} disabled={!form.ingredient_id} className={`w-full ${inputCls}`}>
              <option value="">Otomatis (paling dulu kedaluwarsa)</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {fmtDate(b.expires_at)} · sisa {fmtQty(b.remaining_qty)} {selected?.unit}
                  {b.is_expired ? " · kedaluwarsa" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="w-qty">Jumlah{selected ? ` (${selected.unit})` : ""}</label>
            <input id="w-qty" type="number" min="0" step="any" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={`w-32 ${inputCls}`} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="w-reason">Alasan</label>
            <select id="w-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputCls}>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-sm text-muted" htmlFor="w-note">Catatan</label>
            <input id="w-note" maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={`w-full ${inputCls}`} />
          </div>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving && <Loader2 size={16} className="animate-spin" />}
            Catat
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-danger">{error}</p>}
        {message && (
          <p role="status" className="mt-3 inline-flex items-center gap-1 rounded-sm bg-highlight px-2 py-0.5 text-sm font-medium text-ink">
            <Check size={14} /> {message}
          </p>
        )}
      </form>

      <h2 className="mb-2 font-display text-lg font-semibold tracking-tight text-ink">Riwayat pembuangan</h2>
      {rows === null && !error && (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Memuat riwayat...
        </p>
      )}
      {rows?.length === 0 && (
        <p className="rounded-md border-2 border-dashed border-line bg-white py-8 text-center text-muted">Belum ada pembuangan.</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {rows.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-paper">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{w.ingredient}</p>
                <p className="text-sm text-muted">
                  {fmtDateTime(w.created_at)} · {w.user_name}
                  {w.note ? ` · ${w.note}` : ""}
                </p>
              </div>
              <span className="rounded-sm bg-paper px-2 py-0.5 text-xs font-medium text-muted">{reasonLabel(w.reason)}</span>
              <span className="w-28 text-right font-semibold tabular-nums text-ink">
                -{fmtQty(w.quantity)} {w.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function WastePage() {
  return (
    <AppShell title="Pembuangan bahan" description="Catat bahan yang kedaluwarsa, rusak, atau tumpah. Stok berkurang otomatis." roles={["admin", "store_keeper"]}>
      <WasteView />
    </AppShell>
  );
}