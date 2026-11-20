export function parseId(value: string | string[] | undefined): number | null {
    const v = Array.isArray(value) ? value[0] : value;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  }