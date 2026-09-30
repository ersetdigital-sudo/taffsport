import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyToken, getSessionFromCookie, getTokenFromCookie } from "@/lib/verify-token";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp, isTokenSharedAcrossDevices } from "@/lib/track-guard";

/**
 * GET /api/track/session?order=TAFF-XXXXXX-XXX
 * Validates a signed session token and returns fresh order data.
 * Token can come from:
 *   1. Authorization: Bearer <token> header (primary — client stores in sessionStorage)
 *   2. track_session cookie (fallback)
 */
export async function GET(request: NextRequest) {
  const urlOrder = request.nextUrl.searchParams.get("order")?.toUpperCase();
  if (!urlOrder) {
    return NextResponse.json({ error: "Missing ?order param" }, { status: 400 });
  }

  const ip = clientIp(request.headers);

  // Batas laju per IP. Endpoint ini dipanggil setiap kali customer membuka
  // halaman status (termasuk saat auto-refresh), jadi batasnya longgar —
  // tujuannya menahan skrip yang mengeruk isi order.
  if (!checkRateLimit(`track-session:${ip}`, 60, 60_000)) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
      { status: 429 }
    );
  }

  // Try token from Authorization header first
  let session = null;
  let rawToken: string | null = null;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    rawToken = authHeader.slice(7);
    session = verifyToken(rawToken);
  }

  // Fallback to cookie
  if (!session) {
    const cookieHeader = request.headers.get("cookie");
    const cookieToken = getTokenFromCookie(cookieHeader);
    session = getSessionFromCookie(cookieHeader);
    if (session) rawToken = cookieToken;
  }

  if (!session) {
    return NextResponse.json({ error: "No valid session" }, { status: 401 });
  }

  if (session.orderId !== urlOrder) {
    return NextResponse.json({ error: "Session does not match this order" }, { status: 403 });
  }

  // Token dari link WA yang dibuka dari banyak perangkat berbeda (mis. link
  // diteruskan ke grup) tidak lagi boleh dipakai: halaman meminta verifikasi
  // nomor HP. Klien mengenali ini dari `code`, lalu membuang token lokalnya.
  if (rawToken && isTokenSharedAcrossDevices(rawToken, ip)) {
    return NextResponse.json(
      {
        code: "link_shared",
        error:
          "Link ini sepertinya sudah dibagikan ke orang lain. Verifikasi nomor HP dulu untuk membuka pesanan ini.",
      },
      { status: 403 }
    );
  }

  try {
    // Service role: policy anon pada `orders` sudah ditutup (migrasi 0027).
    // Otorisasi di endpoint ini adalah token sesi bertanda tangan di atas,
    // jadi query-nya boleh memakai service role.
    const supabase = createServiceClient();

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("*")
      .eq("order_number", session.orderId)
      .single();

    if (orderErr || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const { data: history } = await supabase
      .from("order_status_history")
      .select("*")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true });

    const { wo_photos: _wo, ...safeOrder } = order as any;
    return NextResponse.json({ order: safeOrder, history: history || [] });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
