/**
 * Kalimat status notifikasi WhatsApp untuk toast dashboard.
 *
 * Statusnya berasal dari `NotificationTriggerStatus` di lib/fonnte.ts — berkas
 * itu server-only (memuat crypto + service-role client), jadi pemetaan ke bahasa
 * manusia ditaruh di sini supaya Client Component tidak menyeret lib/fonnte.ts
 * ke bundle browser.
 *
 * Dipakai form Pesanan (papan produksi, detail, edit) dan form Maklon supaya
 * semua tempat menyebut hal yang sama. Kalau WA gagal, admin harus tahu — dulu
 * kegagalan itu hilang tanpa jejak di form Pesanan.
 *
 * `queued` bukan hasil kirim, tapi penanda bahwa WA-nya dikirim di latar
 * belakang (lihat `after()` di route pesanan) — jadi toast tidak boleh
 * mengklaim "terkirim".
 */
export function waNote(status?: string | null): string {
  switch (status) {
    case "queued":
      return " · WA sedang dikirim";
    case "sent":
      return " · WA terkirim";
    case "failed":
      return " · WA gagal dikirim";
    case "skipped_duplicate":
      return " · WA sudah pernah dikirim di tahap ini";
    case "log_error":
      return " · WA gagal dicatat";
    default:
      return "";
  }
}
