/**
 * Satu sumber kebenaran untuk "domain publik aplikasi ini".
 *
 * Kenapa tidak di-hardcode: domain project ini sudah pernah pindah
 * (menarasport.vercel.app → taff-sport.vercel.app), dan tiap kali itu
 * terjadi, link tracking yang dikirim ke customer lewat WhatsApp ikut mati.
 *
 * Vercel sudah menyediakan domain produksi sebagai system environment
 * variable, jadi tidak ada yang perlu diisi manual di dashboard:
 *
 *   1. APP_URL                          — override opsional (server-only), untuk
 *                                         dev lokal atau memaksa domain tertentu.
 *   2. VERCEL_PROJECT_PRODUCTION_URL    — domain produksi project, di-set
 *                                         otomatis oleh Vercel. Ini yang dipakai.
 *   3. VERCEL_URL                       — URL deployment spesifik (preview),
 *                                         dipakai kalau (2) tidak tersedia.
 *   4. http://localhost:3000            — dev lokal.
 *
 * Catatan: memakai APP_URL, bukan NEXT_PUBLIC_APP_URL — nilainya hanya
 * dibutuhkan di server, jadi tidak perlu ikut ter-inline ke bundle browser.
 */

/** true kalau sedang berjalan di atas Vercel. */
export function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL);
}

/**
 * Domain publik aplikasi, tanpa trailing slash.
 *
 * Selalu mengembalikan nilai yang bisa dipakai — kalau semua sumber kosong,
 * jatuh ke localhost supaya dev lokal tetap jalan.
 */
export function getAppUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return stripTrailingSlash(ensureProtocol(explicit));

  const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionDomain) return `https://${stripTrailingSlash(productionDomain)}`;

  const deploymentUrl = process.env.VERCEL_URL?.trim();
  if (deploymentUrl) return `https://${stripTrailingSlash(deploymentUrl)}`;

  return "http://localhost:3000";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Terima "domain.com" maupun "https://domain.com" dari APP_URL. */
function ensureProtocol(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
