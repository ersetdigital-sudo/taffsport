/**
 * Satu-satunya tempat format tanggal & jam untuk aplikasi ini.
 *
 * Kenapa dipaksa `Asia/Jakarta`: sebelumnya semua tanggal memakai zona perangkat
 * yang membukanya (`toLocaleDateString` tanpa `timeZone`). Akibatnya:
 *   * customer di WITA/WIT melihat jam berbeda 1-2 jam dari yang dicatat admin;
 *   * tanggal di pesan WhatsApp deadline dihitung di server Vercel yang berzona
 *     UTC, jadi deadline dini hari WIB bisa tertulis sehari lebih awal
 *     ("20 Sep" padahal di Jakarta sudah "21 Sep");
 *   * pengelompokan bulan di laporan bergeser untuk order di sekitar pergantian
 *     bulan, tergantung perangkat yang membuka.
 *
 * Semua fungsi di sini memakai locale `id-ID` (format Indonesia: 16.52, bukan
 * 4:52 PM) dan mengembalikan string kosong untuk nilai kosong/tidak valid —
 * supaya UI tidak pernah menampilkan "Invalid Date".
 *
 * Catatan: waktu dikembalikan apa adanya sesuai instan yang tersimpan (semua
 * kolom waktu di database bertipe `timestamptz`), jadi konversinya selalu benar.
 */

/** Zona waktu resmi aplikasi. */
export const APP_TIME_ZONE = "Asia/Jakarta";

/** Label zona yang ditampilkan ke pengguna. */
export const APP_TIME_ZONE_LABEL = "WIB";

type DateInput = string | number | Date | null | undefined;

const formatters = {
  /** 20 September 2026 pukul 16.52 */
  longDateTime: dateFormatter({
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
  /** 20 Sep 2026, 16.52 */
  shortDateTime: dateFormatter({
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
  /** 20 September 2026 */
  longDate: dateFormatter({ day: "numeric", month: "long", year: "numeric" }),
  /** 20 Sep 2026 */
  shortDate: dateFormatter({ day: "2-digit", month: "short", year: "numeric" }),
  /** 20/09/2026 */
  numericDate: dateFormatter({ day: "2-digit", month: "2-digit", year: "numeric" }),
  /** 20 Sep */
  dayMonth: dateFormatter({ day: "numeric", month: "short" }),
  /** 16.52 */
  time: dateFormatter({ hour: "2-digit", minute: "2-digit" }),
  /** 2026-09-20 — kunci pengelompokan per hari */
  dayKey: dateFormatter(
    { year: "numeric", month: "2-digit", day: "2-digit" },
    "en-CA"
  ),
  /** 2026-09 — kunci pengelompokan per bulan */
  monthKey: dateFormatter({ year: "numeric", month: "2-digit" }, "en-CA"),
};

function dateFormatter(options: Intl.DateTimeFormatOptions, locale = "id-ID") {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: APP_TIME_ZONE });
}

/** Ubah input jadi Date, atau null kalau kosong/tidak valid. */
function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `20 September 2026 pukul 16.52` */
export function formatDateTimeID(value: DateInput): string {
  const date = toDate(value);
  return date ? formatters.longDateTime.format(date) : "";
}

/** `20 Sep 2026, 16.52` */
export function formatShortDateTimeID(value: DateInput): string {
  const date = toDate(value);
  return date ? formatters.shortDateTime.format(date) : "";
}

/**
 * `20 Sep 2026, 16.52 WIB` — dipakai saat label zona perlu tampil eksplisit.
 */
export function formatDateTimeWIB(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "";
  return `${formatters.shortDate.format(date)}, ${formatters.time.format(date)} ${APP_TIME_ZONE_LABEL}`;
}

/** `20 September 2026` */
export function formatLongDateID(value: DateInput): string {
  const date = toDate(value);
  return date ? formatters.longDate.format(date) : "";
}

/** `20 Sep 2026` */
export function formatShortDateID(value: DateInput): string {
  const date = toDate(value);
  return date ? formatters.shortDate.format(date) : "";
}

/** `20/09/2026` */
export function formatNumericDateID(value: DateInput): string {
  const date = toDate(value);
  return date ? formatters.numericDate.format(date) : "";
}

/** `20 Sep` */
export function formatDayMonthID(value: DateInput): string {
  const date = toDate(value);
  return date ? formatters.dayMonth.format(date) : "";
}

/** `16.52` */
export function formatTimeID(value: DateInput): string {
  const date = toDate(value);
  return date ? formatters.time.format(date) : "";
}

/**
 * `2026-09-20` — kunci untuk mengelompokkan/menyaring per hari (WIB).
 * Format `YYYY-MM-DD` dipilih supaya bisa dibandingkan dan diurutkan sebagai teks.
 */
export function dateKeyID(value: DateInput): string {
  const date = toDate(value);
  return date ? formatters.dayKey.format(date) : "";
}

/**
 * `2026-09` — kunci untuk mengelompokkan/menyaring per bulan (WIB).
 * Dipakai laporan bulanan supaya daftar tidak bergeser di pergantian bulan.
 */
export function monthKeyID(value: DateInput): string {
  const date = toDate(value);
  return date ? formatters.monthKey.format(date) : "";
}

/** `2026-09-20` untuk hari ini menurut WIB. */
export function todayKeyID(): string {
  return dateKeyID(new Date());
}

/**
 * Jarak hari menuju sebuah tanggal, dihitung per tanggal WIB (jam diabaikan).
 *
 * Kenapa jam diabaikan: kolom `deadline` bertipe `timestamptz`, tapi admin
 * mengisinya dari `<input type="date">` sehingga nilainya tersimpan sebagai
 * tengah malam UTC — kalau jamnya ikut ditampilkan di WIB hasilnya jadi
 * "07.00", angka yang tidak pernah dipilih siapa pun dan bikin bingung.
 * Yang benar-benar dipakai sistem cuma TANGGAL-nya, jadi perbandingan pun
 * dilakukan antar tanggal WIB. Kembalian `null` untuk nilai kosong/tidak valid.
 */
export function daysUntilID(value: DateInput): number | null {
  const key = dateKeyID(value);
  if (!key) return null;
  const target = Date.parse(`${key}T00:00:00Z`);
  const today = Date.parse(`${todayKeyID()}T00:00:00Z`);
  return Math.round((target - today) / 86_400_000);
}

/**
 * Keterangan singkat jarak ke sebuah tanggal, mis. `hari ini`, `3 hari lagi`,
 * `lewat 2 hari`. Dipakai sebagai penjelas label "Target Selesai" supaya
 * customer langsung paham tanggal itu artinya apa.
 */
export function formatDeadlineNoteID(value: DateInput): string {
  const diff = daysUntilID(value);
  if (diff === null) return "";
  if (diff === 0) return "hari ini";
  return diff > 0 ? `${diff} hari lagi` : `lewat ${Math.abs(diff)} hari`;
}
