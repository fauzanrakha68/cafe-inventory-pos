// Kesalahan yang disebabkan input atau kondisi stok (bukan bug): dibalas apa adanya ke klien.
export class ClientError extends Error {
    constructor(public status: number, message: string, public extra: object = {}) {
      super(message);
    }
  }