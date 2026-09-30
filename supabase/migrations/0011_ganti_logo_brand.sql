-- ============================================================================
-- TAFF Sportwear — 0011 ganti berkas logo brand
-- ============================================================================
-- Logo brand diganti dengan lockup mendatar. Nama berkasnya ikut berubah
-- (`/logo-taff.png` → `/brand-logo.png`) dan itu disengaja: berkas di `public/`
-- dilayani dengan `Cache-Control: immutable, max-age=31536000`, jadi menimpa
-- isi berkas di URL yang sama akan tetap menampilkan logo lama di browser dan
-- CDN yang sudah pernah membukanya.
--
-- Kenapa tidak mengedit 0010: migrasi yang sudah dijalankan tidak boleh diubah
-- isinya. Database baru tetap berakhir benar — 0010 menulis logo lama, lalu
-- migrasi ini menimpanya.
--
-- Aman dijalankan berulang.
-- ============================================================================

update public.brand
set logo_path  = '/brand-logo.png',
    updated_at = now()
where id = 1;

-- Database yang belum menjalankan 0003 tidak punya baris `brand` sama sekali;
-- buat supaya halaman publik tidak jatuh ke cadangan di lib/data.ts.
insert into public.brand (id, name, monogram, tagline, description, whatsapp_number, logo_path)
values (
  1,
  'TAFF Sportwear',
  'TAFF',
  'Tempat Bikin Jersey Futsal Custom.' || chr(10) || 'Desain bebas, harga pabrik, kirim se-Indonesia.',
  'TAFF Sportwear — tempat bikin jersey custom full printing. Desain bebas, harga dari pabrik, kirim se-Indonesia. Konsultasi gratis via WhatsApp.',
  '628115491117',
  '/brand-logo.png'
)
on conflict (id) do nothing;

-- VERIFIKASI
--   select id, name, logo_path, updated_at from public.brand where id = 1;
--   -- logo_path harus '/brand-logo.png'
