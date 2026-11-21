"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { fmtQty, fmtRp } from "@/lib/format";
import { btnGhost, btnPrimary, iconBtn, inputCls } from "@/lib/ui";

type Ingredient = { id: number; name: string; unit: string };
type RecipeLine = { ingredient_id: number; name: string; unit: string; quantity: string };
type Menu = { id: number; name: string; price: number; active: boolean; recipe: RecipeLine[] };
type FormLine = { ingredient_id: string; quantity: string };

const emptyForm = { id: 0, name: "", price: "", active: true, recipe: [{ ingredient_id: "", quantity: "" }] as FormLine[] };

function MenusView() {
  const [menus, setMenus] = useState<Menu[] | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([api<Menu[]>("/menus"), api<Ingredient[]>("/ingredients")]);
      setMenus(m);
      setIngredients(i);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch awal, setState terjadi setelah await
    load();
  }, [load]);

  const unitOf = (id: string) => ingredients.find((i) => String(i.id) === id)?.unit ?? "";

  function setLine(idx: number, patch: Partial<FormLine>) {
    setForm((f) => ({ ...f, recipe: f.recipe.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (form.recipe.some((l) => !l.ingredient_id || !(Number(l.quantity) > 0))) {
      setError("Lengkapi bahan dan takaran di resep.");
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({
        name: form.name,
        price: Number(form.price),
        active: form.active,
        recipe: form.recipe.map((l) => ({ ingredient_id: Number(l.ingredient_id), quantity: Number(l.quantity) })),
      });
      if (form.id) await api(`/menus/${form.id}`, { method: "PUT", body });
      else await api("/menus", { method: "POST", body });
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(m: Menu) {
    setForm({
      id: m.id,
      name: m.name,
      price: String(m.price),
      active: m.active,
      recipe: m.recipe.map((r) => ({ ingredient_id: String(r.ingredient_id), quantity: String(Number(r.quantity)) })),
    });
    setConfirmId(null);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeRow(id: number) {
    setBusyId(id);
    setError("");
    try {
      await api(`/menus/${id}`, { method: "DELETE" });
      setMenus((list) => list?.filter((m) => m.id !== id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirmId(null);
      setBusyId(null);
    }
  }

  const chosen = new Set(form.recipe.map((l) => l.ingredient_id));

  return (
    <>
      <form onSubmit={onSubmit} className="mb-6 rounded-md border border-line bg-white p-4">
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-ink">
          {form.id ? "Ubah menu" : "Tambah menu"}
        </h2>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-sm text-muted" htmlFor="mname">Nama menu</label>
            <input id="mname" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`w-full ${inputCls}`} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="mprice">Harga (Rp)</label>
            <input id="mprice" type="number" min="0" step="1" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={`w-40 ${inputCls}`} />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-ink">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-ink" />
            Aktif dijual
          </label>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-ink">Resep (takaran per 1 porsi)</p>
          <div className="space-y-2">
            {form.recipe.map((line, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Bahan"
                  value={line.ingredient_id}
                  onChange={(e) => setLine(idx, { ingredient_id: e.target.value })}
                  className={`min-w-48 flex-1 ${inputCls}`}
                >
                  <option value="">Pilih bahan</option>
                  {ingredients
                    .filter((i) => String(i.id) === line.ingredient_id || !chosen.has(String(i.id)))
                    .map((i) => (
                      <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                    ))}
                </select>
                <input
                  aria-label="Takaran"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Takaran"
                  value={line.quantity}
                  onChange={(e) => setLine(idx, { quantity: e.target.value })}
                  className={`w-32 ${inputCls}`}
                />
                <span className="w-10 text-sm text-muted">{unitOf(line.ingredient_id)}</span>
                <button
                  type="button"
                  aria-label="Hapus baris resep"
                  disabled={form.recipe.length === 1}
                  onClick={() => setForm((f) => ({ ...f, recipe: f.recipe.filter((_, i) => i !== idx) }))}
                  className={iconBtn}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, recipe: [...f.recipe, { ingredient_id: "", quantity: "" }] }))}
            className={`mt-3 ${btnGhost}`}
          >
            <Plus size={16} /> Tambah bahan
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving && <Loader2 size={16} className="animate-spin" />}
            {form.id ? "Simpan" : "Tambah menu"}
          </button>
          {form.id !== 0 && (
            <button type="button" onClick={() => setForm(emptyForm)} className={btnGhost}>Batal</button>
          )}
        </div>
      </form>

      {error && <p role="alert" className="mb-4 text-sm font-medium text-danger">{error}</p>}
      {menus === null && !error && (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Memuat menu...
        </p>
      )}
      {menus?.length === 0 && (
        <p className="rounded-md border-2 border-dashed border-line bg-white py-10 text-center text-muted">
          Belum ada menu. Pastikan bahan sudah ada, lalu tambahkan menu pertama lewat formulir di atas.
        </p>
      )}

      {menus && menus.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {menus.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-ink">
                  <span className="truncate">{m.name}</span>
                  {!m.active && <span className="rounded-sm bg-paper px-2 py-0.5 text-xs font-medium text-muted">Nonaktif</span>}
                </p>
                <p className="truncate text-sm text-muted">
                  {m.recipe.map((r) => `${r.name} ${fmtQty(r.quantity)} ${r.unit}`).join(" · ")}
                </p>
              </div>
              <span className="font-semibold tabular-nums text-ink">{fmtRp(m.price)}</span>
              {confirmId === m.id ? (
                <div className="flex items-center gap-2">
                  <span className="hidden text-sm text-ink sm:inline">Hapus menu ini?</span>
                  <button
                    type="button"
                    onClick={() => removeRow(m.id)}
                    disabled={busyId === m.id}
                    className="inline-flex items-center gap-1 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {busyId === m.id && <Loader2 size={14} className="animate-spin" />} Hapus
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-paper">
                    Batal
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" aria-label="Ubah menu" className={iconBtn} onClick={() => startEdit(m)}>
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Hapus menu"
                    className="rounded-md p-2 text-muted hover:bg-line/50 hover:text-danger"
                    onClick={() => setConfirmId(m.id)}
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

export default function MenusPage() {
  return (
    <AppShell title="Menu dan resep" description="Harga jual dan takaran bahan per porsi. Stok terpotong sesuai resep saat menu terjual." roles={["admin"]}>
      <MenusView />
    </AppShell>
  );
}