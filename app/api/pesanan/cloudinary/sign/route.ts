import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/admin-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { CLOUDINARY_FOLDER } from "@/lib/cloudinary";
import { cloudinaryUploadSignature } from "@/lib/cloudinary-server";

/**
 * Terbitkan tanda tangan upload Cloudinary untuk satu kali upload.
 *
 * Preset Cloudinary toko ini disetel SIGNED, jadi browser tidak bisa mengirim
 * berkas ke Cloudinary atas nama akun kita tanpa tanda tangan dari server.
 * Endpoint ini yang menerbitkannya — API secret tetap di server dan tidak
 * pernah ikut ke bundle browser.
 *
 * Hanya dashboard yang sudah login yang boleh minta tanda tangan (cookie
 * `pesanan_auth`, lewat getAdminDb).
 *
 * Folder ikut ditandatangani dan ditentukan di sini, bukan oleh browser.
 * Alasannya bukan cuma kerapian: proses hapus aset yatim di
 * lib/cloudinary-server.ts sengaja hanya mengizinkan folder ini, jadi kalau
 * browser bebas memilih folder, foto yang dihapus operator akan tertinggal
 * selamanya dan terus menagih storage.
 */
export async function POST(request: Request) {
  const db = await getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Satu upload = satu tanda tangan. 60/menit cukup lega untuk operator yang
  // mengunggah beberapa foto desain sekaligus, tapi membatasi penyalahgunaan
  // kalau sesi ikut bocor.
  const ip = request.headers.get("x-forwarded-for") ?? "anon";
  if (!checkRateLimit(`cloudinary-sign:${ip}`, 60, 60_000)) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan, coba lagi nanti" },
      { status: 429 }
    );
  }

  const cloudName =
    process.env.CLOUDINARY_CLOUD_NAME ??
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const uploadPreset =
    process.env.CLOUDINARY_UPLOAD_PRESET ??
    process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !apiKey || !uploadPreset) {
    console.error(
      "[cloudinary-sign] ditolak: CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_UPLOAD_PRESET belum lengkap"
    );
    return NextResponse.json(
      { error: "Server belum dikonfigurasi: kredensial Cloudinary belum lengkap." },
      { status: 500 }
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);

  const params: Record<string, string> = {
    folder: CLOUDINARY_FOLDER,
    timestamp: String(timestamp),
    upload_preset: uploadPreset,
  };

  const signature = cloudinaryUploadSignature(params);
  if (!signature) {
    console.error(
      "[cloudinary-sign] ditolak: CLOUDINARY_API_SECRET belum di-set di environment"
    );
    return NextResponse.json(
      { error: "Server belum dikonfigurasi: CLOUDINARY_API_SECRET belum di-set." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    cloudName,
    apiKey,
    uploadPreset,
    folder: params.folder,
    timestamp,
    signature,
  });
}
