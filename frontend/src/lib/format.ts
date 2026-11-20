// Hanya untuk tampilan. Perhitungan tetap di backend (numeric), tidak pernah di float.
export const fmtQty = (v: string | number) =>
  Number(v).toLocaleString('id-ID', { maximumFractionDigits: 3 });

export const fmtRp = (v: string | number) => 'Rp ' + Number(v).toLocaleString('id-ID');

export const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

  export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });