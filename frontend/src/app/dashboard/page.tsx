"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api, getUser } from "@/lib/api";
import { fmtQty } from "@/lib/format";

type StockRow = {
  id: number;
  name: string;
  unit: string;
  min_stock: string;
  available: string;
  is_low: boolean;
};

function LowStock() {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<StockRow[]>("/stock")
      .then((r) => setRows(r.filter((x) => x.is_low)))
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <section>
      <h2 className="mb-2 font-display text-lg font-semibold tracking-tight text-ink">Stok menipis</h2>
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      {!error && rows === null && (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Memuat stok...
        </p>
      )}
      {rows && rows.length === 0 && (
        <p className="inline-flex items-center gap-1 rounded-sm bg-highlight px-2 py-0.5 text-sm font-medium text-ink">
          <Check size={14} /> Semua bahan di atas stok minimum
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
              <AlertCircle size={18} className="shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{r.name}</p>
                <p className="text-sm text-muted">Minimum {fmtQty(r.min_stock)} {r.unit}</p>
              </div>
              <span className="font-semibold tabular-nums text-ink">{fmtQty(r.available)} {r.unit}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm">
        <Link href="/stock" className="font-medium text-ink hover:underline">Lihat semua stok</Link>
      </p>
    </section>
  );
}

function Content() {
  const user = getUser();
  if (user && user.role !== "kasir") return <LowStock />;
  return <p className="text-muted">Menu dan layar kasir akan tersedia di langkah berikutnya.</p>;
}

export default function DashboardPage() {
  return (
    <AppShell title="Dashboard" description="Ringkasan kondisi stok hari ini.">
      <Content />
    </AppShell>
  );
}