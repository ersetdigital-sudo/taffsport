-- ============================================================================
-- TAFF Sportwear — 0010 rebrand identitas toko
-- ============================================================================
-- Baris `brand` (id = 1) dibaca langsung oleh halaman publik — beranda, `/track`,
-- `/status`, `/status/maklon` (lewat `lib/queries.ts` → `getBrand()`) — untuk
-- nama toko, monogram, tagline, deskripsi, dan logo. Selama isinya masih memakai
-- identitas lama, seluruh halaman customer ikut memakai identitas lama walau
-- kodenya sudah di-rebrand.
--
-- Kenapa tidak mengedit 0009: migrasi yang sudah dijalankan tidak boleh diubah
-- isinya — Supabase melacak migrasi per versi, jadi perubahan pada berkas lama
-- tidak akan ikut jalan di database yang sudah dimigrasi. Database baru tetap
-- berakhir benar: 0003 menanam MENARA, 0009 menimpanya jadi VSP Sport, lalu
-- migrasi ini menimpanya lagi jadi TAFF Sportwear.
--
-- Migrasi ini SENGAJA tidak mengubah `whatsapp_number`, `tagline`, dan
-- `app_settings`: tagline tidak memuat nama brand, dan nomor WhatsApp tetap
-- dikelola dari menu Pengaturan admin (`/api/admin/profil-toko`) — mengubahnya
-- di sini akan menimpa nomor yang sudah disetel operator.
--
-- Aman dijalankan berulang.
-- ============================================================================

update public.brand
set name        = 'TAFF Sportwear',
    monogram    = 'TAFF',
    -- Ganti nama di deskripsi SEO tanpa menulis ulang kalimatnya. Dua replace
    -- karena database bisa berhenti di tahap mana pun (masih MENARA, atau sudah
    -- VSP Sport) tergantung migrasi terakhir yang sudah dijalankan.
    description = replace(
                    replace(description, 'MENARA', 'TAFF Sportwear'),
                    'VSP Sport', 'TAFF Sportwear'
                  ),
    logo_path   = '/logo-taff.png',
    updated_at  = now()
where id = 1;

-- Kalau baris `brand` belum ada sama sekali (database yang belum menjalankan 0003),
-- buat barisnya supaya halaman publik tidak jatuh ke nilai cadangan di lib/data.ts.
-- chr(10) dipakai untuk baris baru di tagline: tagline dipecah per baris oleh
-- halaman beranda, jadi pemisahnya harus karakter baris baru sungguhan.
insert into public.brand (id, name, monogram, tagline, description, whatsapp_number, logo_path)
values (
  1,
  'TAFF Sportwear',
  'TAFF',
  'Tempat Bikin Jersey Futsal Custom.' || chr(10) || 'Desain bebas, harga pabrik, kirim se-Indonesia.',
  'TAFF Sportwear — tempat bikin jersey custom full printing. Desain bebas, harga dari pabrik, kirim se-Indonesia. Konsultasi gratis via WhatsApp.',
  '628115491117',
  '/logo-taff.png'
)
on conflict (id) do nothing;
