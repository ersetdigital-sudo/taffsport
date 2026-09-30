# `lib/` — Modul logika bersama

Satu file = satu tanggung jawab. Logika bisnis non-UI ada di sini, dipakai bersama oleh
halaman (server component), komponen dashboard, dan API routes.

## Alur produksi & pesanan

| File | Isi |
| --- | --- |
| `types.ts` | Tipe + konstanta domain: `Order`, `OrderStatus`, `ORDER_STATUS_LIST` (**11 tahap jersey**), `ORDER_STATUS_LABELS`, `STEP_PROGRESS`, `getProgress`, `ORDER_PHOTO_STAGES`, `Brand`/`DbBrand` |
| `order-status.ts` | **Satu sumber kebenaran** aturan "status → tahap → progress" jersey: `stepFromStatus`, `statusFromStep`, `progressPercentFromStatus`, `isOrderCompleted`, `nextStageLabel`, `STATUS_TO_STAGE`, `stageLabel`, normalisasi slug lama (`print` → `cetak_print`), `STAGE_BACKFILL_NOTES` |
| `maklon-status.ts` | Hal yang sama untuk **6 tahap maklon**: `MAKLON_STAGES` (step + slug + label), `maklonStatusFromStep`, `maklonStepFromStatus`, `maklonProgress`, `isMaklonCompleted` |
| `order-number.ts` | Generator nomor pesanan bersama jersey & maklon: `generateOrderNumber`, `jakartaDatePart`, `ORDER_NUMBER_REGEX`. Memakai CSPRNG, bukan `Math.random()` |
| `format-date.ts` | **Satu-satunya** tempat format tanggal & jam, semuanya dipaksa zona `Asia/Jakarta`: `formatDateTimeID`, `formatShortDateTimeID`, `formatDateTimeWIB`, `formatNumericDateID`, `formatShortDateID`, `formatTimeID`, `dateKeyID` (kunci harian), `monthKeyID` (kunci bulanan untuk laporan), plus `daysUntilID`/`formatDeadlineNoteID` (jarak hari ke tanggal *deadline*, dihitung per tanggal WIB) |
| `queries-orders.ts` | Akses data order: `getOrderByTracking` (memverifikasi nomor HP sebelum mengembalikan data), `getAllOrders`, `getOrderById`, `stripWoPhoto` |
| `pesanan-orders-server.ts` | Baca pesanan jersey untuk dashboard: `mapOrder` (bentuk data yang dilihat dashboard), `loadDashboardOrders` (riwayat selesai + foto tahap dibaca **bersamaan**, bukan berurutan), `DashboardOrder`. Dipakai `GET /api/pesanan/orders` **dan** render server `app/pesanan/orders/page.tsx` |
| `maklon-orders-server.ts` | Pasangannya untuk maklon: `mapMaklonOrder`, `loadMaklonOrders`, `MaklonDashboardOrder`. Dipakai `GET /api/pesanan/maklon` dan `app/pesanan/maklon/page.tsx` |
| `product-options.ts` | Daftar pilihan produk form Pesanan & Maklon: `DEFAULT_PRODUCTS`, `mergeProductOptions(extra)`, `rememberProducts(names)`, plus `productFamily(name)` (Atasan / Setelan / null) yang dipakai laporan *Penjualan per Produk* dan bagian produk di beranda. Produk custom disimpan di `localStorage` (per perangkat), jadi form **wajib** memberi `extra` = nama produk order yang sedang dibuka |

Menambah atau mengubah tahap produksi: mulai dari `types.ts` (jersey) atau
`maklon-status.ts` (maklon). Nama tahap di pesan WhatsApp, halaman `/status`, dan daftar
cadangan di dashboard semuanya menurun dari dua file itu — tidak perlu dicari ke tempat lain.

## Notifikasi WhatsApp

| File | Isi |
| --- | --- |
| `fonnte.ts` | Integrasi Fonnte: template pesan (`buildWhatsAppMessage`, `buildMaklonWhatsAppMessage`), URL tracking publik, `sendFonnteMessage` (timeout 10 detik), `triggerStageNotification` & `triggerMaklonStageNotification`, ambil token dari `app_settings` |
| `fonnte-crypto.ts` | Enkripsi/dekripsi token Fonnte (AES-256-GCM, key dari `SETTINGS_ENCRYPTION_KEY`). Token tidak pernah dikirim ke browser |
| `wa.ts` | Normalisasi & validasi nomor WhatsApp + `buildWhatsAppLink` (satu tempat untuk aturan format internasional) |
| `verify-token.ts` | Token tracking bertanda tangan HMAC: `signToken`, `verifyToken`, `signTrackingToken` (berlaku 30 hari), `buildSetCookie` |
| `rate-limit.ts` | Rate limiter in-memory sliding window (`checkRateLimit`) untuk endpoint update tahap. Per-instance server, bukan global |
| `notif-note.ts` | `waNote(status)` — ubah status kirim WA jadi kalimat toast ("WA terkirim", "WA gagal dikirim", …). Client-safe; dipakai form Pesanan & Maklon |

Anti-duplikat notifikasi tidak dicek di kode, tapi di database: RPC
`claim_stage_notification` mengandalkan `UNIQUE (order_id, stage)` di tabel
`stage_notification_logs` (lihat `supabase/README.md`).

## Data & identitas

| File | Isi |
| --- | --- |
| `queries.ts` | Akses data publik server-side: `getBrand()` (identitas toko untuk beranda & halaman tracking) dan `getOperationalHours()` (jam operasional dari `app_settings`), keduanya jatuh ke data statis kalau database tidak bisa dihubungi |
| `data.ts` | Data fallback statis untuk identitas toko: `brand`, `WA_NUMBER`, `JAM_OPERASIONAL` |
| `app-url.ts` | `getAppUrl()` — domain aplikasi untuk link tracking & notifikasi. Membaca `APP_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → `localhost`, jadi tidak ada domain yang di-hardcode |

## Supabase, auth, dan media

| File | Isi |
| --- | --- |
| `supabase/client.ts` | Supabase client untuk browser (anon key) |
| `supabase/server.ts` | `createClient()` (cookie session, anon) dan `createServiceClient()` (service role, menembus RLS — hanya untuk server) |
| `admin-auth.ts` | `getAdminDb()` — guard route handler dashboard: cek cookie `pesanan_auth` / user Supabase, lalu kembalikan service-role client (atau `null` → balas 401) |
| `cloudinary.ts` | Helper Cloudinary sisi browser: `uploadToCloudinary` (perkecil foto → minta tanda tangan ke server → kirim), `optimizeImageUrl` (transformasi `f_auto,q_auto` + batas lebar), `cloudinaryPublicId` & `removedCloudinaryUrls` (deteksi foto yang dibuang operator) |
| `cloudinary-server.ts` | Operasi Cloudinary yang butuh tanda tangan, **hanya untuk route handler**: `cloudinaryUploadSignature` (tanda tangan upload) dan `destroyCloudinaryAssets` (hapus aset yatim) |

## Lain-lain

| File | Isi |
| --- | --- |
| `utils.ts` | `cn()` — penggabung className (`clsx` + `tailwind-merge`) |
