/**
 * Generator nomor pesanan — satu implementasi untuk pesanan jersey dan maklon.
 *
 * Sebelumnya generator ini ditulis dua kali: versi jersey memakai CSPRNG
 * (`crypto.randomBytes`), versi maklon memakai `Math.random()` — artinya nomor
 * maklon bisa diprediksi. Sekarang keduanya memakai fungsi di sini.
 *
 * Format: `<PREFIX><YYMMDD><4 karakter acak>`
 *   TAFF260921K4XQ     → pesanan jersey
 *   MKL260921K4XQ     → pesanan maklon
 *
 * Charset membuang karakter yang sering salah ketik pelanggan
 * (B/I/O/L/0/1), karena nomor ini dikirim lewat WhatsApp dan dibaca manusia.
 *
 * Tanggal memakai zona Asia/Jakarta supaya nomor yang dibuat lewat tengah malam
 * tetap masuk hari kerja yang benar.
 */
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Charset aman: tanpa B, I, O, L, 0, 1. */
export const ORDER_NUMBER_CHARSET = "ACDEFGHJKMNPQRSTUVWXYZ23456789";

export const ORDER_NUMBER_PREFIX = "TAFF";
export const MAKLON_NUMBER_PREFIX = "MKL";

/**
 * Prefix lama yang tetap harus dikenali saat memvalidasi nomor.
 *
 * Nomor yang sudah beredar — dikirim ke pelanggan lewat WhatsApp dan tersimpan
 * di tabel `orders` — memakai prefix `MENARA` — dan `VSP` setelah rename ke TAFF. Kalau prefix baru saja yang
 * diizinkan regex, pesanan lama itu jadi tidak bisa dilacak sama sekali.
 * Jadi prefix baru dipakai untuk nomor yang baru dibuat, sedangkan yang lama
 * tetap diterima.
 */
export const LEGACY_ORDER_NUMBER_PREFIXES = ["MENARA", "VSP"];

/** Panjang bagian acak. */
const CODE_LENGTH = 4;

/** Berapa kali coba ulang bila nomor hasil generate sudah terpakai. */
const MAX_ATTEMPTS = 5;

/**
 * Validasi format nomor pesanan.
 *
 * Dua bentuk diterima:
 * - sekarang: `<PREFIX><YYMMDD><4 karakter>` (prefix baru + MKL untuk maklon)
 * - lama: `<PREFIX>-<YYMMDD>-<3 digit>` — termasuk prefix lama MENARA, supaya
 *   pesanan yang dibuat sebelum rebrand masih bisa dicari di halaman tracking.
 */
const JERSEY_PREFIXES = [ORDER_NUMBER_PREFIX, ...LEGACY_ORDER_NUMBER_PREFIXES];

export const ORDER_NUMBER_REGEX = new RegExp(
  `^(${ORDER_NUMBER_PREFIX}|${MAKLON_NUMBER_PREFIX})\\d{6}[${ORDER_NUMBER_CHARSET}]{${CODE_LENGTH}}$|^(${JERSEY_PREFIXES.join("|")})-\\d{6}-\\d{3}$`
);

/** Tabel yang dicek saat memastikan nomor belum terpakai. */
export type OrderNumberTable = "orders" | "maklon_orders";

const DATE_PART_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
});

/** YYMMDD menurut zona Asia/Jakarta. */
export function jakartaDatePart(date = new Date()): string {
  return DATE_PART_FORMAT.format(date).replace(/\D/g, "");
}

/**
 * Kode acak dari CSPRNG.
 * Modulo sederhana sudah cukup di sini: tujuannya membuat nomor tidak
 * berurutan/tidak mudah ditebak, bukan untuk keperluan kriptografi.
 */
function randomCode(length = CODE_LENGTH): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ORDER_NUMBER_CHARSET[bytes[i] % ORDER_NUMBER_CHARSET.length];
  }
  return code;
}

export interface GenerateOrderNumberOptions {
  /** Tabel untuk pengecekan bentrok. Default `orders`. */
  table?: OrderNumberTable;
  /** Prefix nomor. Default `TAFF`. */
  prefix?: string;
  /** Tanggal acuan (untuk pengujian). Default sekarang. */
  date?: Date;
}

/**
 * Buat nomor pesanan unik.
 *
 * Nomor hasil generate dicek dulu ke database; bila sudah terpakai, coba lagi
 * sampai `MAX_ATTEMPTS` kali, lalu menyerah dengan Error — pemanggil yang
 * memutuskan cara melaporkannya.
 *
 * Client dioper sebagai parameter (tidak dibuat di sini) supaya pemanggil yang
 * sudah memegang service-role client dari getAdminDb() tidak membuat client
 * tambahan, dan supaya fungsi ini gampang diuji.
 */
export async function generateOrderNumber(
  supabase: SupabaseClient,
  options: GenerateOrderNumberOptions = {}
): Promise<string> {
  const table = options.table ?? "orders";
  const prefix = options.prefix ?? ORDER_NUMBER_PREFIX;
  const datePart = jakartaDatePart(options.date);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = `${prefix}${datePart}${randomCode()}`;

    const { data } = await supabase
      .from(table)
      .select("order_number")
      .eq("order_number", candidate)
      .maybeSingle();

    if (!data) return candidate;
  }

  throw new Error(
    `Gagal generate nomor unik untuk ${table} setelah ${MAX_ATTEMPTS} percobaan`
  );
}
