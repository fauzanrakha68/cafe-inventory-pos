"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { btnGhost, btnPrimary, iconBtn, inputCls } from "@/lib/ui";

type Supplier = { id: number; name: string; phone: string | null; address: string | null };

const emptyForm = { id: 0, name: "", phone: "", address: "" };

function SuppliersView() {
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<Supplier[]>("/suppliers"));
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
      const body = JSON.stringify({
        name: form.name,
        phone: form.phone || undefined,
        address: form.address || undefined,
      });
      if (form.id) await api(`/suppliers/${form.id}`, { method: "PUT", body });
      else await api("/suppliers", { method: "POST", body });
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
      await api(`/suppliers/${id}`, { method: "DELETE" });
      setRows((list) => list?.filter((r) => r.id !== id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirmId(null);
      setBusyId(null);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mb-6 rounded-md border border-line bg-white p-4">
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-ink">
          {form.id ? "Ubah supplier" : "Tambah supplier"}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-sm text-muted" htmlFor="sname">Nama</label>
            <input id="sname" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`w-full ${inputCls}`} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted" htmlFor="sphone">Telepon</label>
            <input id="sphone" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={`w-44 ${inputCls}`} />
          </div>
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-sm text-muted" htmlFor="saddr">Alamat</label>
            <input id="saddr" maxLength={200} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={`w-full ${inputCls}`} />
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
          <Loader2 size={16} className="animate-spin" /> Memuat supplier...
        </p>
      )}
      {rows?.length === 0 && (
        <p className="rounded-md border-2 border-dashed border-line bg-white py-10 text-center text-muted">
          Belum ada supplier. Tambahkan supplier pertama lewat formulir di atas.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{r.name}</p>
                <p className="truncate text-sm text-muted">
                  {[r.phone, r.address].filter(Boolean).join(" · ") || "Tanpa kontak"}
                </p>
              </div>
              {confirmId === r.id ? (
                <div className="flex items-center gap-2">
                  <span className="hidden text-sm text-ink sm:inline">Hapus supplier ini?</span>
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
                    aria-label="Ubah supplier"
                    className={iconBtn}
                    onClick={() => {
                      setForm({ id: r.id, name: r.name, phone: r.phone ?? "", address: r.address ?? "" });
                      setConfirmId(null);
                      setError("");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Hapus supplier"
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

export default function SuppliersPage() {
  return (
    <AppShell title="Supplier" description="Pemasok bahan baku untuk purchase order." roles={["admin", "store_keeper"]}>
      <SuppliersView />
    </AppShell>
  );
}