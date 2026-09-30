/**
 * Nilai fallback untuk identitas toko.
 *
 * Dipakai lib/queries.ts saat Supabase tidak terjangkau atau baris `brand`
 * tidak ada. Isi sebenarnya dikelola dari dashboard (menu Pengaturan) —
 * berkas ini cuma jaring pengaman supaya halaman depan dan halaman tracking
 * tetap tampil, bukan sumber kebenaran saat runtime.
 */
import type { Brand } from "@/lib/types";

/**
 * Nomor WhatsApp resmi TAFF Sportwear — satu-satunya tempat nomor cadangan ditulis.
 *
 * Dipakai halaman tracking & pesan WhatsApp saat nilai dari tabel `brand`
 * belum/tidak terbaca (database tidak terjangkau). Nomor yang tampil saat
 * normal tetap dari tabel `brand` (menu Pengaturan admin) lewat `getBrand()
 * di lib/queries.ts, jadi mengganti nomor tidak perlu deploy.
 */
export const WA_NUMBER = "628115491117";

/**
 * Jam operasional cadangan untuk halaman publik (home & tracking).
 * Nilai sebenarnya diatur di menu Pengaturan → Profil Toko
 * (`app_settings.jam_operasional`); ini cuma jaring pengaman kalau database
 * tidak terjangkau atau barisnya belum diisi.
 */
export const JAM_OPERASIONAL = "Senin–Sabtu · 09.00–17.00 WIB";

export const brand: Brand = {
  name: "TAFF Sportwear",
  monogram: "TAFF",
  tagline:
    "Tempat Bikin Jersey Futsal Custom.\nDesain bebas, harga pabrik, kirim se-Indonesia.",
  description:
    "TAFF Sportwear — tempat bikin jersey futsal custom full printing. Desain bebas, harga mulai 85rb, kirim se-Indonesia. Konsultasi gratis via WhatsApp.",
  whatsappNumber: WA_NUMBER,
  logoPath: "/brand-logo.png",
};
