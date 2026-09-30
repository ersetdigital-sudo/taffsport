import { NextRequest, NextResponse } from "next/server";
import { getOrderByTracking } from "@/lib/queries-orders";
import { signTrustedDeviceToken, buildSetCookie } from "@/lib/verify-token";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/track-guard";

/**
 * POST /api/track
 * Verify order number + phone and return order data + history.
 * Returns a signed token in the response body for client-side session persistence.
 * (Set-Cookie is also sent but may be lost due to middleware creating a new response.)
 *
 * Sejak link WhatsApp tidak lagi membuka halaman selamanya, nomor HP adalah
 * gerbang utama — jadi percobaannya dibatasi per IP supaya tidak bisa ditebak
 * beruntun. Token yang keluar di sini berlaku 30 hari dan disimpan di perangkat
 * customer ("ingat perangkat ini"), bukan di link yang bisa diteruskan.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request.headers);
    if (!checkRateLimit(`track-verify:${ip}`, 8, 5 * 60_000)) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan. Tunggu 5 menit lalu coba lagi." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { orderNumber, phone } = body;

    if (!orderNumber || !phone) {
      return NextResponse.json(
        { error: "Nomor pesanan dan nomor HP wajib diisi" },
        { status: 400 }
      );
    }

    const result = await getOrderByTracking(orderNumber, phone);

    if (!result) {
      return NextResponse.json(
        { error: "Pesanan tidak ditemukan atau nomor HP tidak cocok" },
        { status: 404 }
      );
    }

    // Token di body untuk disimpan klien di perangkatnya (localStorage) selama
    // 30 hari; cookie tetap 24 jam sebagai cadangan.
    const token = signTrustedDeviceToken(orderNumber);
    const response = NextResponse.json({ ...result, token });
    response.headers.append("Set-Cookie", buildSetCookie(orderNumber));
    return response;
  } catch {
    return NextResponse.json(
      { error: "Terjadi kesalahan server" },
      { status: 500 }
    );
  }
}
