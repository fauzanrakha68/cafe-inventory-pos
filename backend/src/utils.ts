export function parseId(value: string | string[] | undefined): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Jumlah bahan disimpan numeric(14,3). Hitung dalam bilangan bulat per seperseribu
// (BigInt) supaya tidak ada pembulatan float.
export function toMilli(value: string): bigint {
const [whole, frac = ''] = value.split('.');
return BigInt(whole) * 1000n + BigInt(frac.padEnd(3, '0').slice(0, 3)) * (whole.startsWith('-') ? -1n : 1n);
}

export function fromMilli(n: bigint): string {
const neg = n < 0n;
const abs = neg ? -n : n;
const s = `${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`;
return neg ? `-${s}` : s;
}