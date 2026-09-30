# `supabase/` — Skema database, RLS, dan RPC

Supabase (Postgres) menyimpan data operasional TAFF Sportwear: pesanan jersey, pesanan maklon,
tahap produksi, pengaturan, dan log notifikasi WhatsApp.

Database ini **khusus operasional**. Modul landing page/katalog sudah dibuang beserta
tabelnya, jadi tidak ada lagi tabel konten atau produk di sini.

## Cara menjalankan migrasi

Migrasi dibagi dua jenis, dan membedakannya penting:

| Jenis | File | Siapa yang menjalankan |
| --- | --- | --- |
| **Baseline** | `0001`, `0002`, `0003` | Hanya **database baru**. Hasil squash dari migrasi lama, jadi database produksi sudah setara baseline ini. |
| **Incremental** | `0004` ke atas | **Database produksi**, satu per satu, berurutan. Semuanya idempotent. |

```sql
-- Database baru: jalankan 0001 → 0002 → 0003, lalu seluruh file incremental.
-- Database produksi yang sudah jalan: JANGAN jalankan baseline, cukup 0004, 0005, ...
```

Semua file dijalankan manual lewat Supabase **SQL Editor** (atau `psql`), tidak ada folder
`seed/`. Setelah migrasi dijalankan, pastikan tidak ada error di output: bagian
`VERIFIKASI` di akhir beberapa file berisi query yang bisa langsung ditempel.

## Struktur

| File | Isi |
| --- | --- |
| `0001_baseline_schema.sql` | 11 tabel + index + RLS + policy |
| `0002_baseline_functions.sql` | Trigger `updated_at` + 8 RPC notifikasi/pengaturan |
| `0003_baseline_seed.sql` | Identitas toko + daftar tahap jersey & maklon |
| `0004_perbaiki_notifikasi_tahap.sql` | **Perbaikan bug produksi**: notifikasi WA tahap pesanan jersey tidak pernah terkirim karena tabel log-nya terhapus di migrasi lama |
| `0005_rapikan_akses_warisan.sql` | Cabut policy & grant warisan, buang helper + index duplikat |
| `0006_selaraskan_nama_tahap.sql` | **Perbaikan bug**: `production_steps` masih 9 nama pipeline lama, bikin customer melihat "Tahap 3/9" sementara dashboard "4/11" |
| `0007_nomor_wa_resmi.sql` | Isi nomor WhatsApp resmi di baris `brand` (sebelumnya placeholder, jadi tombol "Hubungi CS" customer mengarah ke nomor kosong). Mengubah nomor berikutnya cukup lewat menu Pengaturan |
| `0008_ulang_kirim_notif_gagal.sql` | **Perbaikan bug**: klaim notifikasi tidak membedakan `success` dari `failed`, jadi tahap yang gagal kirim tidak pernah bisa dikirim ulang walau tokennya sudah diperbaiki |

## Tabel (11)

| Tabel | Isi |
| --- | --- |
| `orders` | Order jersey: nomor order, data customer, deadline, `current_status`, `current_stage`, `last_notified_stage`, `deadline_notified_at`, foto design/WO, `products` (jsonb) |
| `order_status_history` | Riwayat perubahan tahap per order — sumber timeline di halaman tracking |
| `production_steps` | **11** nama tahap jersey (harus sama urutannya dengan `ORDER_STATUS_LIST`), dipakai sebagai label di halaman `/status`; bisa diatur admin |
| `stage_notification_logs` | Anti-duplikat notifikasi WA tahap jersey. `UNIQUE (order_id, stage)` = kuncinya |
| `notification_logs` | Riwayat notifikasi **deadline** (cron): order, nomor HP, status kirim, error, selisih hari |
| `maklon_orders` | Order maklon (toll manufacturing) — tabel terpisah dengan 6 tahap sendiri |
| `maklon_status_history` | Riwayat tahap order maklon |
| `maklon_steps` | Nama 6 tahap maklon untuk halaman `/status/maklon` |
| `maklon_notification_logs` | Anti-duplikat notifikasi WA tahap maklon (1-6) |
| `app_settings` | Key-value pengaturan; nilai rahasia disimpan sebagai ciphertext (AES-256-GCM) |
| `brand` | Identitas toko: `name`, `monogram`, `tagline`, `description`, `whatsapp_number`, `logo_path` |

## RPC (fungsi database)

| Fungsi | Kegunaan |
| --- | --- |
| `claim_stage_notification` / `claim_maklon_stage_notification` | Mengklaim slot pengiriman WA (anti-duplikat, aman dari race condition) |
| `finish_stage_notification` / `finish_maklon_stage_notification` | Menulis hasil pengiriman ke log |
| `mark_last_notified_stage` / `mark_maklon_last_notified_stage` | Menandai tahap terakhir yang WA-nya sudah terkirim |
| `get_app_setting_value` / `set_app_setting` | Baca/tulis pengaturan (nilai token tetap ciphertext) |
| `touch_updated_at` | Trigger pembaruan `updated_at` |

Semuanya `SECURITY DEFINER` dengan `set search_path = public`, dan **hanya bisa dieksekusi
service role**. Ini disengaja: anon key ada di bundle browser, jadi kalau anon masih boleh
memanggilnya, siapa pun bisa menimpa token Fonnte lewat `set_app_setting`, atau memanggil
`claim_stage_notification` dengan stage palsu supaya notifikasi asli dianggap duplikat dan
customer tidak pernah dapat kabar.

## Model keamanan

**Tidak ada tabel operasional yang bisa diakses anon.** Anon key ter-embed di bundle
browser (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), jadi apa pun yang boleh dibaca anon sama dengan
boleh dibaca siapa saja.

- Seluruh akses ke tabel operasional lewat **service role** di server
  (`createServiceClient()` di `lib/supabase/server.ts`).
- Otorisasi diperiksa di **route handler** — `getAdminDb()` untuk dashboard, verifikasi
  nomor HP / token HMAC untuk halaman tracking — bukan diserahkan ke RLS.
- **Satu-satunya policy baca publik**: `brand` (nama toko + WA CS di halaman tracking) dan
  daftar nama tahap (`production_steps`, `maklon_steps`). Read-only.
- Jangan pernah menambahkan `FORCE ROW LEVEL SECURITY`: RLS akan berlaku untuk pemilik
  tabel juga, sehingga service role ikut terblokir dan seluruh dashboard berhenti.
- Mendaftar akun publik di Supabase Auth sudah **dimatikan**.

> Riwayat: sampai migrasi lama `0026`, tabel operasional memakai policy `USING (true)`
> untuk role `public` (SELECT/INSERT/UPDATE, bahkan DELETE untuk maklon). Artinya siapa pun
> yang membuka DevTools bisa membaca seluruh data customer dan mengubah status order lewat
> REST API langsung.

## Konvensi

- Nama file: `NNNN_deskripsi_singkat.sql`, nomor urut tanpa lompatan.
- Tabel baru: tulis RLS + policy-nya sekalian, dan ingat **anon tidak boleh dapat akses**.
- RPC baru: `SECURITY DEFINER`, `set search_path = public`, dan `revoke ... from public,
  anon, authenticated` sebelum `grant execute ... to service_role` — tanpa `revoke`,
  Postgres memberi EXECUTE ke PUBLIC secara default.
- Kalau mengubah tahap produksi, urutan sumber kebenarannya:
  `lib/types.ts` (jersey) atau `lib/maklon-status.ts` (maklon) → lalu nama tahap di tabel
  `production_steps` / `maklon_steps` lewat dashboard.
