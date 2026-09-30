import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { loadStepOrder } from "@/lib/step-order-server";
import {
  isOrderCompleted,
  normalizeOrderStatus,
  STAGE_BACKFILL_NOTES,
  stepFromStatus,
} from "@/lib/order-status";

/**
 * POST /api/track/ensure-history
 * Body: { orderNumber: "TAFF-260907-001", token: "..." }
 *
 * Reads the order's current_status, checks what history entries exist,
 * and INSERTS any missing ones. Returns the complete history.
 * This is a "self-healing" endpoint — it guarantees history is always correct.
 */
export async function POST(request: NextRequest) {
  const { orderNumber, token } = await request.json();

  if (!orderNumber || !token) {
    return NextResponse.json({ error: "Missing orderNumber or token" }, { status: 400 });
  }

  // Verify token
  const { verifyToken } = await import("@/lib/verify-token");
  const session = verifyToken(token);
  if (!session || session.orderId !== orderNumber.toUpperCase()) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Service role: endpoint ini juga menulis baris `order_status_history`
  // (backfill), sedangkan policy anon sudah ditutup di migrasi 0027.
  // Otorisasinya token sesi bertanda tangan yang diverifikasi di atas.
  const supabase = createServiceClient();

  // Get order — select ALL columns so the returned order object is complete
  // (design_photos, products, deadline, etc.) and doesn't wipe out fields
  // the status page already has from /api/track/session
  const { data: orderRaw, error: oErr } = await supabase
    .from("orders")
    .select("*")
    .eq("order_number", orderNumber.toUpperCase())
    .single();
  if (oErr || !orderRaw) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const { wo_photos: _wo, ...order } = orderRaw as any;

  void oErr;

  // Order yang sudah tuntas TIDAK di-backfill: timeline-nya toh penuh, dan
  // menambah baris history bertimestamp sintetis ke order nyata cuma bikin bising.
  const stepOrder = await loadStepOrder(supabase);
  const currentStep = stepFromStatus(order.current_status, stepOrder);
  if (isOrderCompleted(order.current_status) || currentStep <= 1) {
    // At step 1 or unknown — just return existing history
    const { data: history } = await supabase
      .from("order_status_history")
      .select("*")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true });
    return NextResponse.json({ order, history: history || [], inserted: 0 });
  }

  // Get existing history
  const { data: existing } = await supabase
    .from("order_status_history")
    .select("status")
    .eq("order_id", order.id);

  // Normalisasi dulu: baris lama bisa masih pakai slug 9 tahap (print/pres/potong),
  // tanpa ini tahap yang sama bisa ke-insert dua kali dengan slug berbeda.
  const existingStatuses = new Set(
    (existing ?? []).map((h) => normalizeOrderStatus(h.status))
  );

  // Insert missing steps
  const toInsert: {
    order_id: string;
    status: string;
    note: string;
    created_at: string;
  }[] = [];

  for (let i = 0; i < currentStep; i++) {
    const stepStatus = stepOrder[i];
    if (!stepStatus || existingStatuses.has(stepStatus)) continue;

    // Generate timestamp: spread from created_at, 5 minutes apart
    const ts = new Date(order.created_at);
    ts.setMinutes(ts.getMinutes() + i * 5);

    const isLastReached = i === currentStep - 1;
    const note =
      isLastReached && stepStatus === "kirim"
        ? "Sedang diproses untuk pengiriman"
        : STAGE_BACKFILL_NOTES[stepStatus] || "Tahap selesai";

    toInsert.push({
      order_id: order.id,
      status: stepStatus,
      note,
      created_at: ts.toISOString(),
    });
  }

  let insertedCount = 0;
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from("order_status_history").insert(toInsert);
    if (insErr) {
      console.error("ensure-history insert failed:", insErr.message, toInsert);
      return NextResponse.json({
        order,
        history: [],
        inserted: 0,
        insertError: insErr.message,
      });
    }
    insertedCount = toInsert.length;
  }

  // Return complete history
  const { data: finalHistory } = await supabase
    .from("order_status_history")
    .select("*")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    order,
    history: finalHistory || [],
    inserted: insertedCount,
  });
}
