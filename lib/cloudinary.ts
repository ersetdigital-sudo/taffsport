/**
 * Cloudinary — upload gambar dari sisi browser.
 *
 * Preset Cloudinary toko ini disetel SIGNED, jadi browser tidak bisa upload
 * sendiri: komponen client minta tanda tangan ke /api/pesanan/cloudinary/sign
 * dulu, baru mengirim berkasnya memakai tanda tangan itu.
 *
 * Berkas ini di-import komponen client, jadi JANGAN pernah menaruh API key/secret
 * di sini. Tanda tangan dan operasi hapus aset ada di lib/cloudinary-server.ts.
 */

/** Folder induk semua aset gambar TAFF Sportwear di Cloudinary. */
export const CLOUDINARY_FOLDER = "taff-sportwear/desain";

/** Batas ukuran berkas yang diterima dari input file.
 *
 *  Sejak foto diperkecil dulu di browser (lihat downscaleImage), batas ini
 *  bukan lagi soal kredit Cloudinary — melainkan supaya browser HP tidak
 *  dipaksa mendekode berkas raksasa. Yang benar-benar disimpan di Cloudinary
 *  jauh lebih kecil dari angka ini. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Sisi terpanjang gambar yang perlu disimpan ke Cloudinary.
 *
 *  Lightbox di dashboard/status menampilkan maksimal 1600px. Menyimpan versi
 *  4000px dari foto kamera HP tidak menambah apa pun yang bisa dilihat orang,
 *  tapi ikut ditagih sebagai storage dan bandwidth setiap kali foto dikirim. */
export const MAX_UPLOAD_DIMENSION = 1600;

/** Kualitas JPEG saat foto diperkecil ulang.
 *  0.82 masih sulit dibedakan mata untuk foto, tapi ukurannya jauh lebih
 *  kecil daripada 0.95. */
export const JPEG_QUALITY = 0.82;

/** Format yang diterima. HEIC sengaja tidak ikut — Cloudinary bisa mengonversinya,
 *  tapi browser tidak bisa menampilkan hasilnya sebagai preview lokal. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Nilai atribut `accept` untuk input file (harus sama dengan ALLOWED_IMAGE_TYPES). */
export const IMAGE_ACCEPT = ALLOWED_IMAGE_TYPES.join(",");

/** True kalau env Cloudinary tersedia (keduanya env publik). */
export function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME &&
      process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET
  );
}

/**
 * Periksa berkas sebelum diunggah.
 * Mengembalikan pesan kesalahan siap-tampil, atau null kalau berkas lolos.
 */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return `Format ${file.type || "berkas ini"} tidak didukung. Pakai JPG, PNG, atau WebP.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `Ukuran ${mb} MB melebihi batas 2 MB. Kecilkan dulu gambarnya.`;
  }
  return null;
}

/**
 * Perkecil foto di browser SEBELUM dikirim ke Cloudinary.
 *
 * Ini bagian yang paling menghemat kredit. Tagihan Cloudinary dihitung dari
 * (a) besar berkas yang disimpan, (b) bandwidth pengiriman, dan (c) jumlah
 * transformasi. Foto kamera HP gampang 4000px & 2 MB, sementara dashboard
 * paling besar cuma menampilkannya 1600px — piksel di atas itu cuma membakar
 * storage dan bandwidth selamanya tanpa pernah terlihat.
 *
 * Setelah diperkecil, satu foto biasanya tinggal ~200-400 KB (hemat sekitar
 * 5-8x dibanding menyimpan aslinya).
 *
 * Aturannya sengaja konservatif: kalau ragu, KIRIM BERKAS ASLINYA. Gagal
 * memperkecil tidak boleh bikin operator tidak bisa upload.
 */
async function downscaleImage(
  file: File
): Promise<{ blob: Blob; filename: string }> {
  const asIs = { blob: file as Blob, filename: file.name || "foto.jpg" };

  // Browser lawas (mis. Safari lama) tidak punya createImageBitmap.
  if (typeof createImageBitmap !== "function") return asIs;

  let bitmap: ImageBitmap;
  try {
    // `from-image` menghormati orientasi EXIF. Tanpa ini, foto HP yang
    // dipotret miring akan tersimpan miring setelah digambar ulang ke canvas.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return asIs;
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_UPLOAD_DIMENSION) return asIs;

    const scale = MAX_UPLOAD_DIMENSION / longest;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return asIs;

    // PNG bisa punya bagian transparan (mockup desain jersey sering begitu).
    // Kalau dipaksa jadi JPEG, area transparan itu berubah jadi hitam — jadi
    // untuk PNG keluarannya tetap PNG, dan penghematannya datang dari dimensi.
    const keepPng = file.type === "image/png";
    if (!keepPng) {
      // JPEG tidak punya alpha; putih adalah latar paling aman.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, keepPng ? "image/png" : "image/jpeg", JPEG_QUALITY)
    );

    // Kalau hasilnya ternyata TIDAK lebih kecil (mis. PNG kecil tapi padat),
    // pakai berkas aslinya.
    if (!blob || blob.size >= file.size) return asIs;

    const ext = keepPng ? "png" : "jpg";
    const base = (file.name || "foto").replace(/\.[^.]+$/, "");
    return { blob, filename: base + "." + ext };
  } catch {
    return asIs;
  } finally {
    bitmap.close();
  }
}

/** Tanda tangan upload yang diterbitkan server, berlaku untuk satu upload. */
interface UploadGrant {
  cloudName: string;
  apiKey: string;
  uploadPreset: string;
  folder: string;
  timestamp: number;
  signature: string;
}

/**
 * Minta tanda tangan upload ke server.
 *
 * Dipisah dari uploadToCloudinary supaya bisa jalan PARALEL dengan proses
 * memperkecil foto — dua-duanya butuh waktu, dan tidak saling bergantung.
 */
async function requestUploadGrant(): Promise<UploadGrant> {
  const res = await fetch("/api/pesanan/cloudinary/sign", { method: "POST" });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      throw new Error("Sesi berakhir. Login ulang dulu untuk upload foto.");
    }
    throw new Error(data?.error || `Gagal minta izin upload (HTTP ${res.status})`);
  }

  return res.json();
}

/**
 * Upload satu gambar ke Cloudinary.
 *
 * Dua langkah: perkecil di browser, lalu kirim memakai tanda tangan dari
 * server. Folder ditentukan server dan ikut ditandatangani, jadi browser
 * tidak bisa mengarahkan foto ke folder lain.
 */
export async function uploadToCloudinary(
  file: File
): Promise<{ url: string; public_id: string }> {
  const invalid = validateImageFile(file);
  if (invalid) throw new Error(invalid);

  // Perkecil dulu di browser — lihat downscaleImage(). Ini yang paling
  // menghemat kredit, karena berkas inilah yang disimpan permanen.
  const [upload, grant] = await Promise.all([
    downscaleImage(file),
    requestUploadGrant(),
  ]);

  const formData = new FormData();
  formData.append("file", upload.blob, upload.filename);
  formData.append("api_key", grant.apiKey);
  formData.append("timestamp", String(grant.timestamp));
  formData.append("signature", grant.signature);
  formData.append("upload_preset", grant.uploadPreset);
  formData.append("folder", grant.folder);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${grant.cloudName}/image/upload`,
    { method: "POST", body: formData }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error?.message || "Upload gagal");
  }
  const data = await res.json();
  return { url: data.secure_url, public_id: data.public_id };
}

const UPLOAD_MARK = "/upload/";

/**
 * Sisipkan transformasi penghematan kredit ke URL Cloudinary.
 *
 * - `f_auto`  → format paling ringan yang didukung browser (WebP/AVIF)
 * - `q_auto`  → kualitas otomatis, sekecil mungkin tanpa terlihat jelek
 * - `w_<n>`   → jangan kirim gambar 4000px untuk thumbnail
 *
 * Aman dipanggil berulang dan bisa "menaikkan" URL yang sudah punya transformasi:
 * `/upload/f_auto,q_auto/…` + `w=320` → `/upload/f_auto,q_auto,w_320/…`.
 *
 * Sengaja TIDAK memakai `c_fill`: tanpa `h_` crop-nya tidak terjadi, dan dengan
 * `h_` ia memotong isi gambar pada titik tengah — untuk foto desain jersey itu
 * berisiko memotong bagian penting. Pemotongan persegi ditangani CSS
 * (`object-cover`) di elemennya, sesuai ukuran kotak yang sebenarnya.
 */
export function optimizeImageUrl(url: string, width?: number): string {
  if (typeof url !== "string" || !url.includes(UPLOAD_MARK)) return url;

  const at = url.indexOf(UPLOAD_MARK);
  const before = url.slice(0, at);
  const segments = url.slice(at + UPLOAD_MARK.length).split("/");

  // Segmen transformasi selalu memakai koma (`f_auto,q_auto`). Cloudinary juga
  // menerima penulisan tanpa koma, tapi kode ini hanya menghasilkan yang berkoma.
  const transformAt = segments.findIndex((s) => s.includes(","));
  const tokens: string[] =
    transformAt === -1 ? [] : segments[transformAt].split(",").filter(Boolean);
  if (transformAt !== -1) segments.splice(transformAt, 1);

  const put = (token: string) => {
    const key = token.split("_")[0];
    const at = tokens.findIndex((t) => t.split("_")[0] === key);
    if (at === -1) tokens.push(token);
    else tokens[at] = token;
  };
  put("f_auto");
  put("q_auto");
  if (width) put(`w_${width}`);

  const rest = segments.filter(Boolean).join("/");
  return `${before}${UPLOAD_MARK}${tokens.join(",")}/${rest}`;
}

/**
 * Ambil public_id Cloudinary dari URL yang disimpan database.
 *
 * Dipakai untuk menghapus aset tanpa perlu kolom tambahan di tabel: URL hasil
 * upload selalu berbentuk `…/upload/[transformasi/][v1234567/]<public_id>.<ext>`.
 * Segmen transformasi dikenali dari komanya (lihat optimizeImageUrl), segmen
 * versi dari pola `v<angka>`.
 */
export function cloudinaryPublicId(url: string): string | null {
  if (typeof url !== "string" || !url.includes(UPLOAD_MARK)) return null;

  const segments = url.split(UPLOAD_MARK)[1]?.split("/").filter(Boolean) ?? [];
  const start = segments.findIndex(
    (s) => !s.includes(",") && !/^v\d+$/.test(s)
  );
  if (start === -1) return null;

  const path = segments.slice(start).join("/");
  const withoutExt = path.replace(/\.[A-Za-z0-9]+$/, "");
  return withoutExt || null;
}

/**
 * URL yang ADA di `before` tapi TIDAK ada di `after` — yaitu foto yang benar-benar
 * dibuang operator, bukan yang cuma dioptimasi ulang.
 *
 * Dibandingkan lewat public_id, bukan string URL: URL yang tersimpan bisa berisi
 * transformasi berbeda untuk foto yang sama.
 */
export function removedCloudinaryUrls(
  before: unknown,
  after: unknown
): string[] {
  const toList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const kept = new Set(
    toList(after)
      .map(cloudinaryPublicId)
      .filter((id): id is string => Boolean(id))
  );

  return toList(before).filter((url) => {
    const id = cloudinaryPublicId(url);
    return Boolean(id) && !kept.has(id as string);
  });
}
