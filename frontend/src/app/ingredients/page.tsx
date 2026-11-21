"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { fmtQty } from "@/lib/format";
import { btnGhost, btnPrimary, iconBtn, inputCls } from "@/lib/ui";

type Ingredient = { id: number; name: string; unit: string; min_stock: string };

const emptyForm = { id: 0, name: "", unit: "gram", min_stock: "0" };

function IngredientsView() {
  const [rows, setRows] = useState<Ingredient[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<Ingredient[]>("/ingredients"));
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
    setSaving(true);
    try {
      const body = JSON.stringify({ name: form.name, unit: form.unit, min_stock: Number(form.min_stock) });
      if (form.id) await api(`/ingredients/${form.id}`, { method: "PUT", body });
      else await api("/ingredients", { method: "POST", body });
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(id: number) {
    setBusyId(id);
    setError("");
    try {
      await api(`/ingredients/${id}`, { method: "DELETE" });
      setRows((list) => list?.filter((r) => r.id !== id) ?? null);
      setConfirmId(null);
    } catch (err) {
      setError((err as Error).message);
      setConfirmId(null);
    } finally {
      setBusyId(null);
    }
  }

  const empty = rows?.length === 0;

  return (
    <>
      <form onSubmit={onSubmit} className="mb-6 rounded-md border border-line bg-white p-4">
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-ink">
          {form.id ? "Ubah bahan" : "Tambah bahan"}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-sm text-muted" htmlFor="name">Nama</label>
            <input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`w-full ${inputCls}`} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="unit">Satuan dasar</label>
            <select id="unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputCls}>
              <option value="gram">gram</option>
              <option value="ml">ml</option>
              <option value="pcs">pcs</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="min">Stok minimum</label>
            <input id="min" type="number" min="0" step="any" required value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} className={`w-32 ${inputCls}`} />
          </div>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving && <Loader2 size={16} className="animate-spin" />}
            {form.id ? "Simpan" : "Tambah"}
          </button>
          {form.id !== 0 && (
            <button type="button" onClick={() => setForm(emptyForm)} className={btnGhost}>Batal</button>
          )}
        </div>
      </form>

      {error && <p role="alert" className="mb-4 text-sm font-medium text-danger">{error}</p>}
      {rows === null && !error && (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Memuat bahan...
        </p>
      )}
      {empty && (
        <p className="rounded-md border-2 border-dashed border-line bg-white py-10 text-center text-muted">
          Belum ada bahan. Tambahkan bahan pertama lewat formulir di atas.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{r.name}</p>
                <p className="text-sm text-muted">Stok minimum {fmtQty(r.min_stock)} {r.unit}</p>
              </div>
              <span className="rounded-sm bg-paper px-2 py-0.5 text-xs font-medium text-muted">{r.unit}</span>
              {confirmId === r.id ? (
                <div className="flex items-center gap-2">
                  <span className="hidden text-sm text-ink sm:inline">Hapus bahan ini?</span>
                  <button
                    type="button"
                    onClick={() => removeRow(r.id)}
                    disabled={busyId === r.id}
                    className="inline-flex items-center gap-1 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {busyId === r.id && <Loader2 size={14} className="animate-spin" />} Hapus
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-paper">
                    Batal
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label="Ubah bahan"
                    className={iconBtn}
                    onClick={() => {
                      setForm({ id: r.id, name: r.name, unit: r.unit, min_stock: String(Number(r.min_stock)) });
                      setConfirmId(null);
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Hapus bahan"
                    className="rounded-md p-2 text-muted hover:bg-line/50 hover:text-danger"
                    onClick={() => setConfirmId(r.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function IngredientsPage() {
  return (
    <AppShell title="Bahan baku" description="Satuan dasar dan batas stok minimum tiap bahan." roles={["admin", "store_keeper"]}>
      <IngredientsView />
    </AppShell>
  );
}