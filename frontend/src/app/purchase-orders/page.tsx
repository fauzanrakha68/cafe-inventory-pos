"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { fmtDateTime, fmtQty, fmtRp } from "@/lib/format";
import { btnGhost, btnPrimary, iconBtn, inputCls } from "@/lib/ui";

type Supplier = { id: number; name: string };
type Ingredient = { id: number; name: string; unit: string };
type PoRow = {
  id: number;
  status: string;
  note: string | null;
  created_at: string;
  received_at: string | null;
  supplier: string;
  item_count: number;
  total: number;
};
type PoItem = { ingredient_id: number; name: string; unit: string; quantity: string; unit_cost: number };
type PoDetail = { id: number; status: string; supplier: string; items: PoItem[] };
type Line = { ingredient_id: string; quantity: string; unit_cost: string };

const emptyLine: Line = { ingredient_id: "", quantity: "", unit_cost: "" };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

function StatusBadge({ status }: { status: string }) {
  if (status === "ordered") {
    return <span className="rounded-sm bg-highlight px-2 py-0.5 text-sm font-medium text-ink">Dipesan</span>;
  }
  if (status === "received") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-ink">
        <Check size={14} /> Diterima
      </span>
    );
  }
  return <span className="text-sm text-muted">Dibatalkan</span>;
}

function CreateForm({
  suppliers,
  ingredients,
  onCreated,
}: {
  suppliers: Supplier[];
  ingredients: Ingredient[];
  onCreated: (id: number) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const unitOf = (id: string) => ingredients.find((i) => String(i.id) === id)?.unit ?? "";
  const chosen = new Set(lines.map((l) => l.ingredient_id));
  // hanya perkiraan tampilan; total resmi dihitung server
  const estimate = Math.round(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0));

  function setLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (lines.some((l) => !l.ingredient_id || !(Number(l.quantity) > 0) || !Number.isInteger(Number(l.unit_cost)) || Number(l.unit_cost) < 0)) {
      setError("Lengkapi bahan, jumlah, dan harga per satuan (bilangan bulat) di semua baris.");
      return;
    }
    setSaving(true);
    try {
      const po = await api<{ id: number }>("/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplier_id: Number(supplierId),
          note: note || undefined,
          items: lines.map((l) => ({
            ingredient_id: Number(l.ingredient_id),
            quantity: Number(l.quantity),
            unit_cost: Number(l.unit_cost),
          })),
        }),
      });
      setSupplierId("");
      setNote("");
      setLines([emptyLine]);
      onCreated(po.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-6 rounded-md border border-line bg-white p-4">
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-ink">Buat purchase order</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-sm text-muted" htmlFor="po-sup">Supplier</label>
          <select id="po-sup" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`w-full ${inputCls}`}>
            <option value="">Pilih supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-sm text-muted" htmlFor="po-note">Catatan</label>
          <input id="po-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={`w-full ${inputCls}`} />
        </div>
      </div>

      {suppliers.length === 0 && (
        <p className="mt-2 text-sm text-muted">Belum ada supplier. Tambahkan dulu di halaman Supplier.</p>
      )}

      <p className="mb-2 mt-4 text-sm font-medium text-ink">Barang yang dipesan</p>
      <div className="space-y-2">
        {lines.map((line, idx) => (
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
              aria-label="Jumlah"
              type="number"
              min="0"
              step="any"
              placeholder="Jumlah"
              value={line.quantity}
              onChange={(e) => setLine(idx, { quantity: e.target.value })}
              className={`w-28 ${inputCls}`}
            />
            <span className="w-10 text-sm text-muted">{unitOf(line.ingredient_id)}</span>
            <input
              aria-label="Harga per satuan"
              type="number"
              min="0"
              step="1"
              placeholder="Harga/satuan (Rp)"
              value={line.unit_cost}
              onChange={(e) => setLine(idx, { unit_cost: e.target.value })}
              className={`w-52 ${inputCls}`}
            />
            <button
              type="button"
              aria-label="Hapus baris"
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
              className={iconBtn}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine])} className={`mt-3 ${btnGhost}`}>
        <Plus size={16} /> Tambah bahan
      </button>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-sm text-muted">
          Perkiraan total <span className="font-semibold tabular-nums text-ink">{fmtRp(estimate)}</span>
        </p>
        <button type="submit" disabled={saving || suppliers.length === 0} className={btnPrimary}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          Buat PO
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-danger">{error}</p>}
    </form>
  );
}

function PoActions({ po, onDone }: { po: PoDetail; onDone: (message: string) => void }) {
  const [dates, setDates] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"receive" | "cancel" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function receive() {
    setError("");
    if (po.items.some((it) => !dates[it.ingredient_id])) {
      setError("Isi tanggal kedaluwarsa untuk semua bahan.");
      return;
    }
    setBusy("receive");
    try {
      await api(`/purchase-orders/${po.id}/receive`, {
        method: "POST",
        body: JSON.stringify({
          items: po.items.map((it) => ({ ingredient_id: it.ingredient_id, expires_at: dates[it.ingredient_id] })),
        }),
      });
      onDone(`PO #${po.id} diterima, stok bertambah.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setError("");
    setBusy("cancel");
    try {
      await api(`/purchase-orders/${po.id}/cancel`, { method: "POST" });
      onDone(`PO #${po.id} dibatalkan.`);
    } catch (err) {
      setError((err as Error).message);
      setConfirmCancel(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-2 text-sm font-medium text-ink">Terima barang: isi tanggal kedaluwarsa tiap bahan</p>
      <div className="space-y-2">
        {po.items.map((it) => (
          <div key={it.ingredient_id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-40 flex-1 text-sm text-ink">{it.name}</span>
            <input
              aria-label={`Kedaluwarsa ${it.name}`}
              type="date"
              min={today()}
              value={dates[it.ingredient_id] ?? ""}
              onChange={(e) => setDates((d) => ({ ...d, [it.ingredient_id]: e.target.value }))}
              className={inputCls}
            />
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={receive} disabled={busy !== null} className={btnPrimary}>
          {busy === "receive" && <Loader2 size={16} className="animate-spin" />}
          Terima barang
        </button>
        {confirmCancel ? (
          <>
            <span className="text-sm text-ink">Batalkan PO ini?</span>
            <button
              type="button"
              onClick={cancel}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy === "cancel" && <Loader2 size={14} className="animate-spin" />} Ya, batalkan
            </button>
            <button type="button" onClick={() => setConfirmCancel(false)} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-paper">
              Tidak
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmCancel(true)} className={btnGhost}>Batalkan PO</button>
        )}
      </div>
    </div>
  );
}

function PoList({ rows, onChanged }: { rows: PoRow[]; onChanged: (message: string) => void }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [error, setError] = useState("");

  async function toggle(id: number) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setError("");
    try {
      setDetail(await api<PoDetail>(`/purchase-orders/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
      {rows.map((po) => (
        <li key={po.id}>
          <button type="button" onClick={() => toggle(po.id)} aria-expanded={openId === po.id} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-paper">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">PO #{po.id} · {po.supplier}</p>
              <p className="text-sm text-muted">
                {fmtDateTime(po.created_at)} · {po.item_count} bahan
                {po.note ? ` · ${po.note}` : ""}
              </p>
            </div>
            <StatusBadge status={po.status} />
            <span className="w-28 text-right font-semibold tabular-nums text-ink">{fmtRp(po.total)}</span>
            <ChevronDown size={16} className={`text-muted transition-transform ${openId === po.id ? "rotate-180" : ""}`} />
          </button>
          {openId === po.id && (
            <div className="border-t border-line bg-paper px-4 py-3">
              {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
              {!detail || detail.id !== po.id ? (
                !error && <Loader2 size={16} className="animate-spin text-muted" />
              ) : (
                <>
                  <ul className="space-y-1 text-sm">
                    {detail.items.map((it) => (
                      <li key={it.ingredient_id} className="flex justify-between gap-3">
                        <span className="text-ink">{fmtQty(it.quantity)} {it.unit} {it.name}</span>
                        <span className="tabular-nums text-muted">@ {fmtRp(it.unit_cost)}</span>
                      </li>
                    ))}
                  </ul>
                  {po.status === "received" && po.received_at && (
                    <p className="mt-2 text-sm text-muted">Diterima {fmtDateTime(po.received_at)}</p>
                  )}
                  {po.status === "ordered" && (
                    <PoActions
                      po={detail}
                      onDone={(m) => {
                        setOpenId(null);
                        onChanged(m);
                      }}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function PurchaseOrdersView() {
  const [rows, setRows] = useState<PoRow[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, s, i] = await Promise.all([
        api<PoRow[]>("/purchase-orders"),
        api<Supplier[]>("/suppliers"),
        api<Ingredient[]>("/ingredients"),
      ]);
      setRows(p);
      setSuppliers(s);
      setIngredients(i);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch awal, setState terjadi setelah await
    load();
  }, [load]);

  return (
    <>
      <CreateForm
        suppliers={suppliers}
        ingredients={ingredients}
        onCreated={(id) => {
          setMessage(`PO #${id} dibuat.`);
          load();
        }}
      />

      {message && (
        <p role="status" className="mb-4 inline-flex items-center gap-1 rounded-sm bg-highlight px-2 py-0.5 text-sm font-medium text-ink">
          <Check size={14} /> {message}
        </p>
      )}
      {error && <p role="alert" className="mb-4 text-sm font-medium text-danger">{error}</p>}
      {rows === null && !error && (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Memuat purchase order...
        </p>
      )}
      {rows?.length === 0 && (
        <p className="rounded-md border-2 border-dashed border-line bg-white py-10 text-center text-muted">
          Belum ada purchase order.
        </p>
      )}
      {rows && rows.length > 0 && (
        <PoList
          rows={rows}
          onChanged={(m) => {
            setMessage(m);
            load();
          }}
        />
      )}
    </>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <AppShell title="Purchase order" description="Pesan bahan ke supplier, lalu terima barang untuk menambah stok." roles={["admin", "store_keeper"]}>
      <PurchaseOrdersView />
    </AppShell>
  );
}