/**
 * Pembacaan data pesanan MAKLON untuk DASHBOARD ADMIN (server-only).
 *
 * Sama seperti lib/pesanan-orders-server.ts untuk jersey: pemetaan baris →
 * bentuk dashboard ditaruh di satu tempat supaya GET /api/pesanan/maklon dan
 * render server (app/pesanan/maklon/page.tsx) mengirim bentuk data yang sama.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAKLON_FINAL_STEP,
  clampMaklonStep,
  isMaklonCompleted,
  maklonProgress,
} from "@/lib/maklon-status";

/** Satu baris tabel `maklon_orders` → bentuk yang dipakai dashboard. */
export function mapMaklonOrder(row: any) {
  const hasTracking = !!(row.tracking_number && row.courier);
  const step = clampMaklonStep(row.current_stage || 1);
  const pct = maklonProgress(step, hasTracking);
  return {
    id: row.order_number,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    product_name: row.product_type || "",
    quantity: row.quantity ? `${row.quantity} pcs` : "-",
    material: row.material || "",
    sizes: row.sizes || "",
    design_photos: Array.isArray(row.design_photos)
      ? row.design_photos.map((p: any) => (typeof p === "string" ? p : p.url || "")).filter(Boolean)
      : [],
    wo_photos: Array.isArray(row.wo_photos)
      ? row.wo_photos.map((p: any) => (typeof p === "string" ? p : p.url || "")).filter(Boolean)
      : [],
    products: Array.isArray(row.products) ? row.products : [],
    current_step: step,
    note: row.design_notes || "",
    note_time: row.updated_at || "",
    courier: row.courier || "",
    tracking_number: row.tracking_number || "",
    is_done: isMaklonCompleted(row.current_status) || (step === MAKLON_FINAL_STEP && hasTracking),
    deadline: row.deadline || null,
    created_at: row.created_at,
    pct,
  };
}

/** Bentuk satu order maklon persis seperti yang dipakai dashboard. */
export type MaklonDashboardOrder = ReturnType<typeof mapMaklonOrder>;

/**
 * Semua pesanan maklon, terbaru dulu.
 * Gagal baca dilempar sebagai Error supaya pemanggil memutuskan sendiri:
 * route handler membalas 500, halaman merender dengan daftar kosong.
 */
export async function loadMaklonOrders(supabase: SupabaseClient): Promise<MaklonDashboardOrder[]> {
  const { data, error } = await supabase
    .from("maklon_orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []).map(mapMaklonOrder);
}
