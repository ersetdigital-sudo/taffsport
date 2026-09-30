/**
 * Pembacaan data pesanan jersey untuk DASHBOARD ADMIN (server-only).
 *
 * Dipakai dua jalur:
 *   1. GET /api/pesanan/orders — dipanggil browser setelah halaman terbuka
 *      (refresh berkala, setelah simpan, dsb).
 *   2. app/pesanan/orders/page.tsx — dibaca saat render server, supaya kartu
 *      KPI dan tabel sudah berisi data di HTML pertama, bukan menunggu fetch
 *      dari browser dulu.
 *
 * Karena itu pemetaan baris → bentuk yang dipakai dashboard ada di SINI, bukan
 * di route handler: dua jalur itu wajib mengirim bentuk data yang identik.
 * Kalau berbeda, kartu bisa berkedip berubah setelah fetch pertama selesai.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DONE_STATUS,
  isOrderCompleted,
  normalizeOrderStatus,
  progressPercentFromStatus,
  stepFromStatus,
} from "@/lib/order-status";
import { loadStepOrder, type StepOrder } from "@/lib/step-order-server";

/**
 * Waktu tuntas tiap order diambil dari `order_status_history`, bukan kolom baru.
 *
 * Baris history berstatus "selesai" sudah ditulis setiap kali tahap terakhir
 * disimpan (lihat route status), jadi tidak perlu migrasi kolom tambahan dan
 * order yang tuntas sebelum fitur ini ada pun ikut terhitung. Baris diurut
 * menurun supaya pengambilan pertama per order = kejadian paling akhir (penting
 * untuk order yang pernah dibuka ulang lalu dituntaskan lagi).
 */
async function fetchDoneAt(supabase: any, orderIds: string[]) {
  const latest = new Map<string, string>();
  if (orderIds.length === 0) return latest;

  const { data, error } = await supabase
    .from("order_status_history")
    .select("order_id, created_at")
    .eq("status", DONE_STATUS)
    .in("order_id", orderIds)
    .order("created_at", { ascending: false });

  if (error) {
    // Badge "bulan ini" cukup tampil 0 kalau riwayat tidak terbaca — jangan
    // sampai kegagalan di sini bikin seluruh daftar pesanan gagal dimuat.
    console.error("Gagal membaca riwayat selesai:", error.message);
    return latest;
  }

  for (const row of data || []) {
    if (!latest.has(row.order_id)) latest.set(row.order_id, row.created_at);
  }
  return latest;
}

/**
 * Foto progres tiap tahap, per order — dikirim ke dashboard supaya operator bisa
 * MELIHAT foto yang sudah ia unggah untuk sebuah tahap, bukan cuma menambah buta.
 *
 * Satu tahap = satu foto, dan fotonya tersimpan di baris `order_status_history`
 * milik tahap itu (lihat PATCH /api/pesanan/orders/[id]/status). Karena satu tahap
 * bisa punya beberapa baris riwayat, yang dipakai adalah baris TERAKHIR yang
 * berisi foto — aturan yang sama dipakai halaman customer supaya tidak mungkin
 * dashboard dan halaman customer menampilkan foto berbeda.
 */
async function fetchStagePhotos(supabase: any, orderIds: string[]) {
  const byOrder = new Map<string, Record<string, string>>();
  if (orderIds.length === 0) return byOrder;

  const { data, error } = await supabase
    .from("order_status_history")
    .select("order_id, status, photo_url, created_at")
    .in("order_id", orderIds)
    .not("photo_url", "is", null)
    .neq("photo_url", "")
    .order("created_at", { ascending: true });

  if (error) {
    // Foto tahap cuma pelengkap — kalau gagal dibaca, daftar pesanan tetap harus
    // tampil (tanpa foto), jangan sampai seluruh dashboard ikut kosong.
    console.error("Gagal membaca foto tahap:", error.message);
    return byOrder;
  }

  for (const row of data || []) {
    const slug = normalizeOrderStatus(row.status);
    const map = byOrder.get(row.order_id) ?? {};
    map[slug] = row.photo_url; // urutan menaik → baris terakhir yang menang
    byOrder.set(row.order_id, map);
  }
  return byOrder;
}

/** Satu baris tabel `orders` → bentuk yang dipakai dashboard. */
export function mapOrder(
  row: any,
  doneAt: string | null = null,
  stepOrder?: StepOrder,
  stagePhotos: Record<string, string> = {}
) {
  const hasTracking = !!(row.tracking_number && row.courier);
  const step = stepFromStatus(row.current_status, stepOrder);
  // Persentase dihitung dari NOMOR tahap pada urutan yang berlaku, supaya sama
  // dengan angka "Tahap x dari 11" di halaman customer.
  const pct = progressPercentFromStatus(row.current_status, hasTracking, stepOrder);
  return {
    id: row.order_number,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    product_name: row.product_type || "",
    quantity: row.quantity ? `${row.quantity} pcs` : "-",
    material: row.material || "",
    sizes: row.sizes || "",
    design_photos: Array.isArray(row.design_photos) ? row.design_photos.map((p: any) =>
      typeof p === "string" ? p : p.url || ""
    ).filter(Boolean) : [],
    wo_photos: Array.isArray(row.wo_photos) ? row.wo_photos.map((p: any) => typeof p === "string" ? p : p.url || "").filter(Boolean) : [],
    products: Array.isArray(row.products) ? row.products : [],
    current_step: step,
    note: row.design_notes || "",
    note_time: row.updated_at || "",
    courier: row.courier || "",
    tracking_number: row.tracking_number || "",
    is_done: isOrderCompleted(row.current_status) || (step === 11 && hasTracking),
    deadline: row.deadline || null,
    created_at: row.created_at,
    done_at: doneAt,
    pct,
    stage_photos: stagePhotos,
  };
}

/** Bentuk satu order persis seperti yang dipakai dashboard (turunan `mapOrder`). */
export type DashboardOrder = ReturnType<typeof mapOrder>;

/** Seluruh pesanan + riwayat selesai + foto tahap, siap dipakai dashboard. */
export async function loadDashboardOrders(supabase: SupabaseClient): Promise<DashboardOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = data || [];
  const orderIds = rows.map((row: any) => row.id);

  // Ketiga pembacaan ini tidak saling bergantung (dua-duanya cuma butuh daftar
  // id order dari query di atas), jadi dijalankan bersamaan. Sebelumnya
  // berurutan: daftar tahap → riwayat selesai → foto tahap, jadi waktu tunggu
  // dashboard = jumlah dari ketiganya, bukan yang paling lambat.
  const [stepOrder, doneAtByUuid, stagePhotosByUuid] = await Promise.all([
    loadStepOrder(supabase),
    fetchDoneAt(supabase, orderIds),
    fetchStagePhotos(supabase, orderIds),
  ]);

  return rows.map((row: any) =>
    mapOrder(
      row,
      doneAtByUuid.get(row.id) || null,
      stepOrder,
      stagePhotosByUuid.get(row.id) || {}
    )
  );
}
