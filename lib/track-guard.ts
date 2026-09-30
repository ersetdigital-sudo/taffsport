/**
 * Pengaman link tracking — IP dipakai sebagai PENANDA, bukan pengunci identitas.
 *
 * Kenapa bukan pengunci: di Indonesia satu IP publik sering dipakai bersama
 * (CGNAT Telkomsel / Indosat / XL) dan IP ponsel berubah setiap pindah sinyal
 * atau sambung ulang. Kalau IP dipakai untuk mengikat sesi, yang kena justru
 * customer sendiri — sementara orang yang iseng tinggal pakai VPN. Jadi IP di
 * sini hanya dipakai untuk dua hal yang aman-aman saja:
 *
 * 1. BASI: sidik jari "berapa perangkat berbeda yang membuka token ini".
 *    Token dari link WhatsApp yang dibuka dari banyak IP berbeda dalam 24 jam
 *    (mis. link diteruskan ke grup WA) dianggap bocor → token itu diminta
 *    verifikasi nomor HP lagi (lihat app/api/track/session).
 * 2. PEMBATAS LAJU per IP untuk percobaan verifikasi nomor HP
 *    (lihat app/api/track dan lib/rate-limit.ts).
 *
 * Batas kemampuan: semuanya in-memory per instance, sama seperti
 * lib/rate-limit.ts. Di Vercel, beberapa instance server jalan terpisah, jadi
 * penghitungan ini "best effort" — cukup mempersulit penyebaran link, bukan
 * jaminan mutlak. Kalau nanti mau tegas, angkanya perlu disimpan di database.
 *
 * Nomor HP tetap menjadi gerbang UTAMA: halaman tetap bisa dibuka kalau token
 * link sudah mati/dianggap bocor, asal nomor HP pesanan dicocokkan.
 */

/** Jendela hitung: "banyak IP" dihitung dalam 24 jam terakhir. */
const IP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Jumlah IP berbeda yang masih dianggap wajar untuk satu token.
 *
 * Tiga, bukan dua: satu orang bisa saja membuka dari wifi rumah lalu data
 * seluler di hari yang sama, dan itu bukan tanda link dibagi. Yang keempat
 * barulah pola "diteruskan ke grup".
 */
const MAX_IPS_PER_TOKEN = 3;

/** Batas jumlah token yang dilacak sekaligus (bersih-bersih oportunistik). */
const MAX_TRACKED_TOKENS = 2000;

const tokenIps = new Map<string, Map<string, number>>();

/**
 * IP klien dari header proxy. Vercel menaruh IP asli di elemen pertama
 * `x-forwarded-for`; sisanya rantai proxy dan tidak boleh dipercaya.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Sidik jari token: token mentah tidak pernah disimpan di memori. */
function fingerprint(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 31 + token.charCodeAt(i)) | 0;
  }
  return `${hash.toString(36)}:${token.length}`;
}

/**
 * Catat bahwa `token` dibuka dari `ip`, lalu jawab: apakah token ini sudah
 * dipakai dari terlalu banyak perangkat berbeda?
 *
 * Return true = token dianggap bocor → pemanggil sebaiknya menolak token itu
 * dan meminta verifikasi nomor HP. IP yang sudah tercatat (termasuk IP yang
 * sama berulang) tidak pernah menghitung sebagai "perangkat baru", jadi
 * customer yang membuka halaman berkali-kali dari jaringan yang sama tidak
 * terkena.
 */
export function isTokenSharedAcrossDevices(token: string, ip: string): boolean {
  const key = fingerprint(token);
  const now = Date.now();
  const ips = tokenIps.get(key) ?? new Map<string, number>();

  // Buang IP yang sudah keluar dari jendela waktu.
  for (const [known, seenAt] of ips) {
    if (now - seenAt > IP_WINDOW_MS) ips.delete(known);
  }

  const isKnownDevice = ips.has(ip);
  const shared = !isKnownDevice && ips.size >= MAX_IPS_PER_TOKEN;

  ips.set(ip, now);
  tokenIps.set(key, ips);

  // Bersih-bersih oportunistik supaya map tidak tumbuh tanpa batas.
  if (tokenIps.size > MAX_TRACKED_TOKENS) {
    for (const [k, seen] of tokenIps) {
      const stillAlive = [...seen.values()].some((t) => now - t <= IP_WINDOW_MS);
      if (!stillAlive) tokenIps.delete(k);
    }
  }

  return shared;
}
