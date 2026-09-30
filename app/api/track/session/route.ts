import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyToken, getSessionFromCookie } from "@/lib/verify-token";

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

  // Try token from Authorization header first
  let session = null;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    session = verifyToken(authHeader.slice(7));
  }

  // Fallback to cookie
  if (!session) {
    const cookieHeader = request.headers.get("cookie");
    session = getSessionFromCookie(cookieHeader);
  }

  if (!session) {
    return NextResponse.json({ error: "No valid session" }, { status: 401 });
  }

  if (session.orderId !== urlOrder) {
    return NextResponse.json({ error: "Session does not match this order" }, { status: 403 });
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
