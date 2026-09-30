/**
 * Cloudinary — upload gambar dari sisi browser.
 *
 * Preset Cloudinary toko ini disetel SIGNED, jadi browser tidak bisa upload
 * sendiri: komponen client minta tanda tangan ke /api/pesanan/cloudinary/sign
 * dulu, baru mengirim berkasnya memakai tanda tangan itu.
 *
 * Berkas ini di-import komponen client, jadi JANGAN pernah menaruh API key/secret
 * di sini. Tanda tangan dan operasi hapus aset ada di lib/cloudinary-server.ts.
 *
 * Setiap tahap upload melaporkan dirinya ke lib/upload-progress.ts, sehingga
 * dashboard bisa menampilkan "2,4 MB → 320 KB · 45%" tanpa satu pun pemanggil
 * uploadToCloudinary perlu menambah parameter.
 */
import {
  beginUpload,
  failUpload,
  finishUpload,
  formatBytes,
  markUploadReady,
  setUploadPercent,
} from "@/lib/upload-progress";

/** Folder induk semua aset gambar TAFF Sportwear di Cloudinary. */
export const CLOUDINARY_FOLDER = "taff-sportwear/desain";

/** Batas ukuran BERKAS ASLI yang boleh dipilih operator.
 *
 *  Sejak foto diperkecil dulu di browser (lihat downscaleImage), batas ini
 *  bukan lagi soal kredit Cloudinary — melainkan supaya browser HP tidak
 *  dipaksa mendekode berkas raksasa. Foto kamera HP sekarang umumnya 3-6 MB,
 *  jadi angka 2 MB yang lama membuat operator mentok di pesan "kecilkan dulu"
 *  padahal pengecilnya belum sempat jalan. Yang benar-benar disimpan di
 *  Cloudinary tetap dibatasi MAX_UPLOAD_BYTES di bawah. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Batas ukuran berkas yang benar-benar DIKIRIM ke Cloudinary.
 *
 *  Diperiksa SETELAH foto diperkecil, bukan sebelum: kalau pengecilan gagal
 *  (browser tidak bisa mendekode) dan berkas aslinya kebesaran, upload-nya
 *  ditolak dengan pesan yang sama seperti dulu — daripada diam-diam mengirim
 *  berkas 6 MB ke akun toko. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Sisi terpanjang gambar yang perlu disimpan ke Cloudinary.
 *
 *  Lightbox di dashboard/status menampilkan maksimal 1600px. Menyimpan versi
 *  4000px dari foto kamera HP tidak menambah apa pun yang bisa dilihat orang,
 *  tapi ikut ditagih sebagai storage dan bandwidth setiap kali foto dikirim. */
export const MAX_UPLOAD_DIMENSION = 1600;

/** Kualitas saat foto diperkecil ulang (dipakai JPEG & WebP).
 *  0.82 masih sulit dibedakan mata untuk foto, tapi ukurannya jauh lebih
 *  kecil daripada 0.95. */
export const JPEG_QUALITY = 0.82;

/**
 * Ambang "sudah cukup ringan": berkas yang lebih kecil dari ini dikirim apa
 * adanya tanpa didekode + di-encode ulang.
 *
 * Dulu patokannya cuma DIMENSI, dan itu bikin foto yang dimensinya sudah
 * "cukup kecil" (mis. PNG 1024px) tetap dikirim utuh 900 KB — padahal formatnya
 * bisa dipadatkan jauh lebih banyak. Di jaringan seluler, 900 KB vs 150 KB itu
 * bedanya puluhan detik.
 */
const SKIP_REENCODE_BYTES = 300 * 1024;

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
 *
 * Hanya format & batas berkas ASLI yang diperiksa di sini; batas ukuran kirim
 * dicek setelah foto diperkecil (lihat MAX_UPLOAD_BYTES).
 */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return `Format ${file.type || "berkas ini"} tidak didukung. Pakai JPG, PNG, atau WebP.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `Ukuran ${formatBytes(file.size)} melebihi batas ${formatBytes(MAX_IMAGE_BYTES)}. File ini tidak bisa dikecilkan otomatis — pakai gambar lain.`;
  }
  return null;
}

/**
 * Perkecil foto di browser SEBELUM dikirim ke Cloudinary.
 *
 * Ini bagian yang paling menghemat kredit. Tagihan Cloudinary dihitung dari
 * (a) besar berkas yang disimpan, (b) bandwidth pengiriman, dan (c) jumlah
 * transformasi. Foto kamera HP gampang 4000px & 6 MB, sementara dashboard
 * paling besar cuma menampilkannya 1600px — piksel di atas itu cuma membakar
 * storage dan bandwidth selamanya tanpa pernah terlihat.
 *
 * Setelah diperkecil, satu foto biasanya tinggal ~150-300 KB (hemat sekitar
 * 5-8x dibanding menyimpan aslinya) — sebagian besar penghematan itu datang
 * dari pilihan format di encodeCanvas(), bukan cuma dari kecilnya dimensi.
 *
 * Aturannya sengaja konservatif: kalau ragu, KIRIM BERKAS ASLINYA. Gagal
 * memperkecil tidak boleh bikin operator tidak bisa upload.
 */
/**
 * Ukuran gambar tanpa mendekode seluruh pikselnya.
 *
 * Memakai elemen <img> + object URL: browser cuma membaca header berkas untuk
 * mengisi naturalWidth/naturalHeight, jadi hasilnya hampir instan walau fotonya
 * 12 MP. Dipakai untuk MEMUTUSKAN perlu diperkecil atau tidak — supaya foto
 * yang sudah cukup kecil tidak didekode penuh hanya untuk dibuang lagi.
 *
 * `null` = ukuran tidak terbaca; pemanggil kembali ke jalur lama (dekode penuh).
 */
function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (size: { width: number; height: number } | null) => {
      URL.revokeObjectURL(url);
      resolve(size);
    };
    img.onload = () =>
      done(img.naturalWidth && img.naturalHeight
        ? { width: img.naturalWidth, height: img.naturalHeight }
        : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Encode ulang canvas ke format paling ringan yang didukung browser.
 *
 * WebP dicoba lebih dulu karena dua alasan: hasilnya paling kecil untuk gambar
 * seperti desain jersey, dan ia mendukung transparansi — jadi mockup PNG tidak
 * perlu diubah jadi JPEG (yang akan menghitamkan area transparannya).
 *
 * Browser tanpa dukungan WebP (Safari < 14) TIDAK mengembalikan null, tapi
 * diam-diam menyerahkan PNG — karena itu hasilnya diperiksa dari `blob.type`,
 * bukan dari keberadaan blob-nya.
 */
async function encodeCanvas(
  canvas: HTMLCanvasElement,
  sourceIsPng: boolean
): Promise<{ blob: Blob | null; ext: string }> {
  const webp = await canvasToBlob(canvas, "image/webp", JPEG_QUALITY);
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp" };

  const fallbackType = sourceIsPng ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(canvas, fallbackType, JPEG_QUALITY);
  // PNG punya alpha; JPEG tidak, jadi latarnya putih (lihat pemanggilnya).
  return { blob, ext: sourceIsPng ? "png" : "jpg" };
}

async function downscaleImage(
  file: File
): Promise<{ blob: Blob; filename: string }> {
  const asIs = { blob: file as Blob, filename: file.name || "foto.jpg" };

  // Browser lawas (mis. Safari lama) tidak punya createImageBitmap.
  if (typeof createImageBitmap !== "function") return asIs;

  // Jalur cepat: foto yang dimensinya sudah cukup kecil DAN berkasnya sudah
  // ringan dikirim apa adanya — tidak perlu didekode penuh dulu (foto 1200px
  // dari HP lama sering begini). Berkas yang dimensinya kecil tapi berat tetap
  // lewat jalur encode di bawah, karena justru itu yang bikin upload lambat.
  const probed = await readImageSize(file);
  const smallDimension =
    !!probed && Math.max(probed.width, probed.height) <= MAX_UPLOAD_DIMENSION;
  if (smallDimension && file.size <= SKIP_REENCODE_BYTES) return asIs;

  let bitmap: ImageBitmap;
  try {
    // `from-image` menghormati orientasi EXIF. Tanpa ini, foto HP yang
    // dipotret miring akan tersimpan miring setelah digambar ulang ke canvas.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return asIs;
  }

  try {
    // Dimensi yang sudah cukup kecil TIDAK diperbesar; yang diperbaiki cuma
    // format & kompresinya (mis. PNG 900 KB → WebP ~150 KB).
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale =
      longest > MAX_UPLOAD_DIMENSION ? MAX_UPLOAD_DIMENSION / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return asIs;

    // PNG bisa punya bagian transparan (mockup desain jersey sering begitu).
    // Latar putih hanya dipakai kalau sumbernya memang tidak punya alpha.
    const sourceIsPng = file.type === "image/png";
    if (!sourceIsPng) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const { blob, ext } = await encodeCanvas(canvas, sourceIsPng);

    // Kalau hasilnya ternyata TIDAK lebih kecil (mis. PNG kecil tapi padat),
    // pakai berkas aslinya.
    if (!blob || blob.size >= file.size) return asIs;

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

  // Diumumkan ke indikator upload di dashboard; lihat lib/upload-progress.ts.
  const jobId = beginUpload(file.name || "foto", file.size);

  try {
    return await sendToCloudinary(file, jobId);
  } catch (e) {
    failUpload(jobId);
    throw e;
  }
}

/** Isi upload sesungguhnya — dipisah supaya semua jalur keluar pasti menutup indikator. */
async function sendToCloudinary(
  file: File,
  jobId: number
): Promise<{ url: string; public_id: string }> {
  // Perkecil dulu di browser — lihat downscaleImage(). Ini yang paling
  // menghemat kredit, karena berkas inilah yang disimpan permanen.
  const [upload, grant] = await Promise.all([
    downscaleImage(file),
    requestUploadGrant(),
  ]);

  // Sejak titik ini ukurannya sudah pasti — inilah angka yang dikirim ke
  // Cloudinary, dan itulah yang ditampilkan ke operator.
  markUploadReady(jobId, upload.blob.size);

  // Pengecilan sengaja "pessimistis": kalau browser tidak bisa mendekode (atau
  // hasilnya tidak lebih kecil), berkas ASLINYA yang dipakai — dan berkas asli
  // bisa saja di atas batas kirim. Itu baru ketahuan di sini.
  if (upload.blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Foto ini masih ${formatBytes(upload.blob.size)} setelah dicoba dikecilkan (batas ${formatBytes(MAX_UPLOAD_BYTES)}). Pakai gambar lain atau perkecil dulu.`
    );
  }

  const formData = new FormData();
  formData.append("file", upload.blob, upload.filename);
  formData.append("api_key", grant.apiKey);
  formData.append("timestamp", String(grant.timestamp));
  formData.append("signature", grant.signature);
  formData.append("upload_preset", grant.uploadPreset);
  formData.append("folder", grant.folder);

  const data = await postToCloudinary(
    `https://api.cloudinary.com/v1_1/${grant.cloudName}/image/upload`,
    formData,
    jobId
  );
  finishUpload(jobId);
  return { url: data.secure_url, public_id: data.public_id };
}

/**
 * Kirim berkas ke Cloudinary sambil melaporkan persentasenya.
 *
 * Memakai XMLHttpRequest, bukan fetch: hanya XHR yang memberi event progres
 * pengiriman (`upload.onprogress`). Dengan `fetch`, satu-satunya kabar yang
 * bisa ditampilkan adalah "sedang mengunggah" tanpa angka — dan untuk foto
 * 300 KB di jaringan seluler, menunggu tanpa angka itulah yang terasa lambat.
 * Pesan kesalahannya sengaja sama dengan versi fetch sebelumnya supaya teks di
 * dashboard tidak berubah.
 */
function postToCloudinary(
  url: string,
  formData: FormData,
  jobId: number
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    // Tanpa batas waktu, koneksi yang macet membuat indikatornya berputar
    // selamanya tanpa kabar apa pun. Dua menit sudah jauh di atas waktu kirim
    // foto 300 KB, bahkan di jaringan seluler lambat.
    xhr.timeout = 120_000;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadPercent(jobId, e.loaded, e.total);
    };
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        resolve(data);
        return;
      }
      reject(new Error(data?.error?.message || "Upload gagal"));
    };
    xhr.onerror = () => reject(new Error("Koneksi terputus saat upload. Coba lagi."));
    xhr.ontimeout = () => reject(new Error("Upload terlalu lama. Coba lagi."));

    xhr.send(formData);
  });
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
