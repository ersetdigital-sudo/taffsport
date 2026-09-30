/**
 * Kemajuan upload foto, sebagai "papan pengumuman" kecil untuk UI.
 *
 * Kenapa store di luar React, bukan state di komponen: `uploadToCloudinary()`
 * dipakai dari belasan tempat (foto design, WO, foto tahap, di tiga dashboard
 * berbeda) dan semuanya perlu menampilkan hal yang sama — sedang mengecilkan
 * foto? berapa MB yang dikirim? berapa persen? Menaruh state-nya di dalam
 * `uploadToCloudinary` (lihat lib/cloudinary.ts) berarti tidak ada satu pun
 * call site yang perlu diubah, dan operator melihat SATU indikator yang
 * konsisten, bukan angka berbeda-beda di tiap kotak.
 *
 * Modul ini juga diimpor server-side secara tidak langsung: lib/cloudinary.ts
 * dipakai route handler untuk `removedCloudinaryUrls`. Karena itu TIDAK boleh
 * ada akses DOM/window di top-level — semua isinya variabel biasa.
 */

/** Fase yang bisa dilihat operator. */
export type UploadPhase = "compress" | "upload";

/** Satu pekerjaan upload yang sedang berjalan. */
export type UploadJob = {
  id: number;
  /** Nama berkas yang dipilih operator. */
  name: string;
  phase: UploadPhase;
  /** 0-100, hanya bermakna di fase "upload". */
  percent: number;
  /** Ukuran berkas asli yang dipilih. */
  originalBytes: number;
  /** Ukuran yang benar-benar dikirim (setelah diperkecil); 0 kalau belum tahu. */
  uploadBytes: number;
};

/** `2,4 MB` / `320 KB` — satu-satunya tempat angka byte jadi teks. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

let nextId = 1;
let job: UploadJob | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Untuk `useSyncExternalStore` di komponen indikator. */
export function subscribeUploadJob(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Snapshot saat ini. Referensinya hanya berubah saat isinya berubah — syarat
 * `useSyncExternalStore`, kalau tidak React akan menganggapnya selalu berubah.
 */
export function getUploadJob(): UploadJob | null {
  return job;
}

/** Upload dimulai — operator baru memilih berkas. */
export function beginUpload(name: string, originalBytes: number): number {
  const id = nextId++;
  job = { id, name, phase: "compress", percent: 0, originalBytes, uploadBytes: 0 };
  emit();
  return id;
}

/** Foto selesai diperkecil; sekarang ukuran kirimnya sudah pasti. */
export function markUploadReady(id: number, uploadBytes: number) {
  if (job?.id !== id) return;
  job = { ...job, phase: "upload", percent: 0, uploadBytes };
  emit();
}

/** Progres kirim berkas (dari XHR). */
export function setUploadPercent(id: number, loaded: number, total: number) {
  if (job?.id !== id || total <= 0) return;
  const percent = Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
  if (percent === job.percent && job.uploadBytes === total) return;
  job = { ...job, phase: "upload", percent, uploadBytes: total };
  emit();
}

/**
 * Upload selesai. Indikatornya sengaja tidak langsung hilang: 100% ditahan
 * sebentar supaya hasilnya terbaca, baru menghilang (dan tidak ada kedipan
 * "gagal" hanya karena bar-nya keburu lenyap).
 */
export function finishUpload(id: number, keepMs = 700) {
  if (job?.id !== id) return;
  job = { ...job, phase: "upload", percent: 100 };
  emit();
  setTimeout(() => {
    if (job?.id === id) {
      job = null;
      emit();
    }
  }, keepMs);
}

/** Upload gagal — indikatornya langsung dibuang; pesannya ada di form. */
export function failUpload(id: number) {
  if (job?.id !== id) return;
  job = null;
  emit();
}
