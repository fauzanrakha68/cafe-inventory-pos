"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { btnGhost, inputCls } from "@/lib/ui";

type Json = Record<string, unknown> | null;
type Log = {
  id: number;
  action: string;
  entity: string;
  entity_id: number | null;
  before_data: Json;
  after_data: Json;
  created_at: string;
  user_name: string | null;
};
type Page = { rows: Log[]; has_more: boolean };

const PAGE_SIZE = 30;

const ENTITIES: Record<string, string> = {
  menu: "Menu",
  ingredient: "Bahan",
  purchase_order: "Purchase order",
  opname: "Stock opname",
  waste: "Pembuangan",
  user: "Pengguna",
};
const ACTIONS: Record<string, string> = {
  create: "membuat",
  update: "mengubah",
  delete: "menghapus",
  receive: "menerima barang",
  cancel: "membatalkan",
};

const show = (v: unknown) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "-"));

// Tampilkan hanya yang berubah (update); selain itu tampilkan isi data apa adanya.
function Details({ log }: { log: Log }) {
  const { before_data: b, after_data: a } = log;
  if (b && a) {
    const keys = Object.keys({ ...b, ...a }).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    if (keys.length === 0) return <p className="text-sm text-muted">Tidak ada nilai yang berubah.</p>;
    return (
      <ul className="space-y-1 text-sm">
        {keys.map((k) => (
          <li key={k} className="break-words">
            <span className="font-medium text-ink">{k}</span>{" "}
            <span className="text-muted line-through">{show(b[k])}</span>{" "}
            <span className="text-ink">{show(a[k])}</span>
          </li>
        ))}
      </ul>
    );
  }
  const data = a ?? b;
  if (!data) return null;
  return (
    <ul className="space-y-1 text-sm">
      {Object.entries(data).map(([k, v]) => (
        <li key={k} className="break-words">
          <span className="font-medium text-ink">{k}</span> <span className="text-muted">{show(v)}</span>
        </li>
      ))}
    </ul>
  );
}

function AuditView() {
  const [entity, setEntity] = useState("");
  const [rows, setRows] = useState<Log[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const fetchPage = useCallback(
    async (offset: number) => {
      const q = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (entity) q.set("entity", entity);
      return api<Page>(`/audit-logs?${q}`);
    },
    [entity]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchPage(0);
        if (cancelled) return;
        setRows(page.rows);
        setHasMore(page.has_more);
        setError("");
        setOpenId(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore() {
    if (!rows) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(rows.length);
      setRows([...rows, ...page.rows]);
      setHasMore(page.has_more);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-md border border-line bg-white p-4">
        <div>
          <label className="mb-1 block text-sm text-muted" htmlFor="a-entity">Jenis data</label>
          <select
            id="a-entity"
            value={entity}
            onChange={(e) => {
              setRows(null);
              setEntity(e.target.value);
            }}
            className={inputCls}
          >
            <option value="">Semua</option>
            {Object.entries(ENTITIES).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p role="alert" className="mb-4 text-sm font-medium text-danger">{error}</p>}
      {rows === null && !error && (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Memuat log...
        </p>
      )}
      {rows?.length === 0 && (
        <p className="rounded-md border-2 border-dashed border-line bg-white py-10 text-center text-muted">
          Belum ada aktivitas tercatat.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {rows.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => setOpenId(openId === l.id ? null : l.id)}
                aria-expanded={openId === l.id}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-paper"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {l.user_name ?? "Pengguna dihapus"} {ACTIONS[l.action] ?? l.action}{" "}
                    {(ENTITIES[l.entity] ?? l.entity).toLowerCase()}
                    {l.entity_id ? ` #${l.entity_id}` : ""}
                  </p>
                  <p className="text-sm text-muted">{fmtDateTime(l.created_at)}</p>
                </div>
                <span className="rounded-sm bg-paper px-2 py-0.5 text-xs font-medium text-muted">
                  {ENTITIES[l.entity] ?? l.entity}
                </span>
                <ChevronDown size={16} className={`text-muted transition-transform ${openId === l.id ? "rotate-180" : ""}`} />
              </button>
              {openId === l.id && (
                <div className="border-t border-line bg-paper px-4 py-3">
                  <Details log={l} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-4 text-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className={btnGhost}>
            {loadingMore && <Loader2 size={16} className="animate-spin" />}
            Muat lebih banyak
          </button>
        </div>
      )}
    </>
  );
}

export default function AuditPage() {
  return (
    <AppShell title="Audit log" description="Jejak siapa mengubah apa, lengkap dengan nilai sebelum dan sesudah." roles={["admin"]}>
      <AuditView />
    </AppShell>
  );
}