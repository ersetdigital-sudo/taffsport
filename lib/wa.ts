/**
 * WhatsApp Click-to-Chat link utilities.
 *
 * iOS/Safari does NOT auto-normalize local-format phone numbers (e.g.
 * "0811..."). The number MUST be in international format without the
 * leading zero: "62811...". This module centralises that logic so every
 * WA link in the codebase goes through the same normaliser.
 */

/** Strip non-digits, convert local ID format → international. */
export function normalizeWhatsAppNumber(raw: string): string {
  // 1. Strip everything that isn't a digit
  let digits = raw.replace(/\D/g, "");

  // 2. Already international with country code
  if (digits.startsWith("62")) return digits;

  // 3. Local format starting with 0 → replace 0 with 62
  if (digits.startsWith("0")) return "62" + digits.slice(1);

  // 4. Bare number starting with 8 (missing leading 0 or 62)
  if (digits.startsWith("8")) return "62" + digits;

  // 5. Fallback — return cleaned digits as-is (best effort)
  return digits;
}

/**
 * Nomor HP apa adanya untuk ditempel: hanya digit, tanpa dash/spasi/kurung.
 *
 * Dipakai di detail pesanan admin supaya nomor yang tampil bisa langsung
 * di-paste ke WhatsApp atau form ekspedisi tanpa dirapikan manual dulu.
 * Formatnya sengaja TIDAK diubah ke 62… — nomor tetap seperti yang diisi
 * pembeli (biasanya 08…), cuma tanda bacanya dibuang.
 *
 *   0822-9984-9418 → 082299849418
 */
export function compactPhone(raw: string | null | undefined): string {
  return (raw || "").replace(/\D/g, "");
}

/** Build a WhatsApp Click-to-Chat URL that works on both Android & iOS. */
export function buildWhatsAppLink(phone: string, text: string): string {
  const normalized = normalizeWhatsAppNumber(phone);
  return `https://api.whatsapp.com/send?phone=${normalized}&text=${encodeURIComponent(text)}`;
}

/**
 * Link `wa.me` siap pakai (dipakai halaman tracking & tombol CS).
 *
 * Nomor mentah dari tabel `brand` boleh berformat lokal (0812…) — konversi ke
 * format internasional ditangani di satu tempat ini, supaya tidak ada lagi
 * salinan logika "0 → 62" yang tersebar di tiap halaman.
 */
export function waMeUrl(phone: string, text?: string): string {
  const normalized = normalizeWhatsAppNumber(phone);
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${normalized}${query}`;
}

/**
 * Nomor untuk DITAMPILKAN ke customer: format lokal berkelompok.
 *
 * Diambil dari nilai yang sama dengan yang dipakai link WA, jadi teks di
 * footer tidak bisa lagi tertinggal saat nomor di menu Pengaturan diganti
 * (dulu footer menulis "WhatsApp: 0811-5491-117" sebagai teks mati).
 *
 *   628115491117 → 0811-5491-117
 *   085194154165 → 0851-9415-4165
 */
export function formatWhatsAppDisplay(phone: string): string {
  const intl = normalizeWhatsAppNumber(phone);
  const local = intl.startsWith("62") ? "0" + intl.slice(2) : intl;
  return (local.match(/\d{1,4}/g) || [local]).join("-");
}
