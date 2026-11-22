"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { api, downloadFile } from "@/lib/api";
import { fmtDate, fmtRp } from "@/lib/format";
import { btnGhost, inputCls } from "@/lib/ui";

type Totals = { sales_count: number; revenue: number; cogs: number; profit: number; waste_cost: number };
type Day = Totals & { date: string };
type Report = {
  from: string;
  to: string;
  days: Day[];
  menus: { name: string; qty: number; revenue: number }[];
  totals: Totals;
};

const wibToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
function shift(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-white p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
    </div>
  );
}

function ReportsView() {
  const [to, setTo] = useState(wibToday);
  const [from, setFrom] = useState(() => shift(wibToday(), -6));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setError("");
    if (!from || !to) return;
    if (from > to) {
      setError("Tanggal awal tidak boleh setelah tanggal akhir.");
      return;
    }
    setLoading(true);
    try {
      setReport(await api<Report>(`/reports/summary?from=${from}&to=${to}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch awal, setState terjadi setelah await
    load();
  }, [load]);

  async function exportCsv() {
    setError("");
    setDownloading(true);
    try {
      await downloadFile(`/reports/summary.csv?from=${from}&to=${to}`, `laporan-${from}_${to}.csv`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const preset = (days: number) => {
    const end = wibToday();
    setTo(end);
    setFrom(shift(end, -(days - 1)));
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-md border border-line bg-white p-4">
        <div>
          <label className="mb-1 block text-sm text-muted" htmlFor="r-from">Dari</label>
          <input id="r-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-muted" htmlFor="r-to">Sampai</label>
          <input id="r-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => preset(1)} className={btnGhost}>Hari ini</button>
          <button type="button" onClick={() => preset(7)} className={btnGhost}>7 hari</button>
          <button type="button" onClick={() => preset(30)} className={btnGhost}>30 hari</button>
        </div>
        <button type="button" onClick={exportCsv} disabled={downloading || !!error} className={`ml-auto ${btnGhost}`}>
          {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Ekspor CSV
        </button>
      </div>

      {error && <p role="alert" className="mb-4 text-sm font-medium text-danger">{error}</p>}
      {loading && !report && (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Memuat laporan...
        </p>
      )}

      {report && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Transaksi" value={report.totals.sales_count.toLocaleString("id-ID")} />
            <Tile label="Pendapatan" value={fmtRp(report.totals.revenue)} />
            <Tile label="HPP (modal bahan)" value={fmtRp(report.totals.cogs)} />
            <Tile label="Laba kotor" value={fmtRp(report.totals.profit)} />
            <Tile label="Nilai pembuangan" value={fmtRp(report.totals.waste_cost)} />
          </div>

          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight text-ink">Per hari</h2>
          <div className="mb-6 overflow-x-auto rounded-md border border-line bg-white">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="border-b border-line bg-paper text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Tanggal</th>
                  <th className="px-4 py-2 text-right font-medium">Transaksi</th>
                  <th className="px-4 py-2 text-right font-medium">Pendapatan</th>
                  <th className="px-4 py-2 text-right font-medium">HPP</th>
                  <th className="px-4 py-2 text-right font-medium">Laba kotor</th>
                  <th className="px-4 py-2 text-right font-medium">Pembuangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {report.days.map((d) => (
                  <tr key={d.date} className="hover:bg-paper">
                    <td className="px-4 py-2 text-ink">{fmtDate(d.date)}</td>
                    <td className="px-4 py-2 text-right">{d.sales_count}</td>
                    <td className="px-4 py-2 text-right">{fmtRp(d.revenue)}</td>
                    <td className="px-4 py-2 text-right text-muted">{fmtRp(d.cogs)}</td>
                    <td className="px-4 py-2 text-right font-medium text-ink">{fmtRp(d.profit)}</td>
                    <td className="px-4 py-2 text-right text-muted">{fmtRp(d.waste_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight text-ink">Menu terlaris</h2>
          {report.menus.length === 0 ? (
            <p className="rounded-md border-2 border-dashed border-line bg-white py-8 text-center text-muted">
              Belum ada penjualan pada rentang ini.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
              {report.menus.map((m, i) => (
                <li key={m.name} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                  <span className="w-6 text-sm tabular-nums text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{m.name}</span>
                  <span className="w-24 text-right tabular-nums text-muted">{m.qty} terjual</span>
                  <span className="w-32 text-right font-semibold tabular-nums text-ink">{fmtRp(m.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <AppShell title="Laporan" description="Pendapatan, HPP, laba kotor, dan pembuangan per hari (zona WIB)." roles={["admin"]}>
      <ReportsView />
    </AppShell>
  );
}