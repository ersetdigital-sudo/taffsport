import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAdminAccess } from "@/lib/admin-auth";
import {
  getFonnteToken,
  normalizeAndValidatePhone,
  sendFonnteMessage,
} from "@/lib/fonnte";
import { checkRateLimit } from "@/lib/rate-limit";

const TEST_MESSAGE =
  "Test notifikasi dari TAFF Sportwear. Jika Anda menerima pesan ini, token Fonnte berfungsi dengan baik.";

/**
 * POST /api/admin/settings/fonnte/test — kirim pesan uji (admin only).
 * Memvalidasi token tersimpan + nomor HP admin tanpa membocorkan token.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  if (!(await hasAdminAccess(supabase))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(`fonnte-test:${request.headers.get("x-forwarded-for") ?? "anon"}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan, coba lagi nanti" },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const phone = normalizeAndValidatePhone(
    typeof body?.target === "string" ? body.target : ""
  );

  if (!phone) {
    return NextResponse.json(
      {
        error:
          "Nomor HP tidak valid. Gunakan format Indonesia, mis. 08123456789 atau 628123456789.",
      },
      { status: 400 }
    );
  }

  const token = await getFonnteToken();
  if (!token) {
    return NextResponse.json(
      { error: "Token Fonnte belum disimpan. Simpan token terlebih dahulu." },
      { status: 400 }
    );
  }

  const result = await sendFonnteMessage(phone, TEST_MESSAGE);

  if (!result.success) {
    // Fonnte memakai `detail` untuk sukses dan `reason` untuk penolakan
    // (mis. "token invalid", "device disconnected"). Dulu hanya `detail` yang
    // dibaca, jadi penolakan apa pun tampil sebagai pesan generik dan admin
    // tidak tahu harus memperbaiki apa.
    const reason =
      typeof result.response?.reason === "string"
        ? result.response.reason
        : typeof result.response?.detail === "string"
          ? result.response.detail
          : null;
    return NextResponse.json(
      {
        success: false,
        error: reason
          ? `Fonnte menolak pengiriman: ${reason}. Periksa token & status device di dashboard Fonnte.`
          : "Gagal mengirim pesan uji. Periksa token & status device Fonnte.",
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
}