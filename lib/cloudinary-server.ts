/**
 * Cloudinary — operasi sisi server yang butuh tanda tangan.
 *
 * Di-import HANYA dari route handler. API secret tidak boleh sampai ke bundle
 * browser, jadi jangan pernah import berkas ini dari komponen client.
 *
 * Dipakai untuk membuang aset yang sudah tidak dirujuk database: operator
 * mengganti/menghapus foto di dashboard, atau menghapus pesanannya. Tanpa ini,
 * tiap ganti foto menumpuk file yatim dan kredit Cloudinary habis percuma.
 */
import { createHash } from "crypto";
import { CLOUDINARY_FOLDER, cloudinaryPublicId } from "./cloudinary";

/** True kalau kredensial admin Cloudinary lengkap. */
export function cloudinaryAdminConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Hitung signature Cloudinary: parameter diurutkan alfabetis, disambung
 * `k=v&k=v`, ditambah api_secret di ujung, lalu SHA-1 (hex).
 */
function sign(params: Record<string, string>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(payload + apiSecret).digest("hex");
}

/**
 * Tanda tangan untuk upload dari browser (signed upload).
 *
 * Preset Cloudinary toko ini disetel SIGNED, jadi browser tidak boleh upload
 * sendiri tanpa tanda tangan ini — dan itu memang tujuannya: kalau unsigned,
 * siapa pun yang tahu nama cloud-nya bisa menitipkan berkas ke akun kita.
 *
 * `file`, `api_key`, dan `cloud_name` TIDAK ikut ditandatangani (Cloudinary
 * mengecualikan ketiganya). Parameter LAIN yang dikirim wajib ikut semua,
 * karena Cloudinary menghitung ulang tanda tangan dari yang benar-benar
 * diterimanya.
 *
 * Mengembalikan null kalau API secret belum di-set, supaya pemanggil bisa
 * membalas pesan yang jelas alih-alih mengirim tanda tangan kosong.
 */
export function cloudinaryUploadSignature(
  params: Record<string, string>
): string | null {
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiSecret) return null;
  return sign(params, apiSecret);
}

/**
 * Hapus aset Cloudinary berdasarkan URL yang tersimpan di database.
 *
 * - URL yang bukan milik cloud kita (mis. gambar lama dari instalasi lain)
 *   dilewati, bukan dicoba dihapus.
 * - Kegagalan TIDAK dilempar: menyimpan pesanan tidak boleh gagal hanya karena
 *   Cloudinary bermasalah. Yang gagal cukup dicatat di log server.
 *
 * Mengembalikan jumlah aset yang benar-benar terhapus.
 */
export async function destroyCloudinaryAssets(urls: string[]): Promise<number> {
  if (!cloudinaryAdminConfigured() || urls.length === 0) return 0;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME as string;
  const apiKey = process.env.CLOUDINARY_API_KEY as string;
  const apiSecret = process.env.CLOUDINARY_API_SECRET as string;

  // Dedupe: satu foto bisa muncul di design_photos dan wo_photos sekaligus.
  const ids = Array.from(
    new Set(
      urls
        .map(cloudinaryPublicId)
        .filter((id): id is string => Boolean(id))
    )
  );

  let deleted = 0;

  for (const publicId of ids) {
    // Hanya aset di folder kita. Ini juga mencegah public_id kiriman client
    // yang menunjuk ke aset Cloudinary lain di akun yang sama.
    if (!publicId.startsWith(CLOUDINARY_FOLDER + "/")) {
      console.warn("Cloudinary: lewati hapus di luar folder", publicId);
      continue;
    }

    const params: Record<string, string> = {
      public_id: publicId,
      invalidate: "true",
      timestamp: String(Math.floor(Date.now() / 1000)),
    };

    const body = new URLSearchParams({
      ...params,
      api_key: apiKey,
      signature: sign(params, apiSecret),
    });

    try {
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        }
      );
      const data = await res.json().catch(() => null);
      if (res.ok && (data?.result === "ok" || data?.result === "not found")) {
        deleted += 1;
      } else {
        console.error("Cloudinary: gagal hapus aset", publicId, data?.error ?? res.status);
      }
    } catch (err) {
      console.error("Cloudinary: error saat hapus aset", publicId, err);
    }
  }

  return deleted;
}
