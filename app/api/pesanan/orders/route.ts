import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/admin-auth";
import { generateOrderNumber } from "@/lib/order-number";
import {
  DONE_STATUS,
  isOrderCompleted,
  normalizeOrderStatus,
  progressPercentFromStatus,
  stepFromStatus,
} from "@/lib/order-status";
import { loadStepOrder, type StepOrder } from "@/lib/step-order-server";
import { triggerStageNotification, type NotificationTriggerStatus } from "@/lib/fonnte";

// POST di route ini mengirim WA tahap 1 (Fonnte timeout 10 detik). Tanpa
// durasi eksplisit, function bisa dimatikan di tengah jalan saat provider
// lambat — notifikasinya hilang padahal pesanannya sudah tersimpan.
export const maxDuration = 30;

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

function mapOrder(
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

export async function GET() {
  const supabase = await getAdminDb();
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stepOrder = await loadStepOrder(supabase);
  const rows = data || [];
  const orderIds = rows.map((row: any) => row.id);
  const doneAtByUuid = await fetchDoneAt(supabase, orderIds);
  const stagePhotosByUuid = await fetchStagePhotos(supabase, orderIds);

  return NextResponse.json({
    orders: rows.map((row: any) =>
      mapOrder(
        row,
        doneAtByUuid.get(row.id) || null,
        stepOrder,
        stagePhotosByUuid.get(row.id) || {}
      )
    ),
  });
}

export async function POST(request: Request) {
  const supabase = await getAdminDb();
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    id,
    customer_name,
    customer_phone,
    product_name,
    quantity,
    material,
    sizes,
    deadline,
    created_at,
    design_photos,
    wo_photos,
    products,
  } = body;

  if (!customer_name || !customer_phone) {
    return NextResponse.json(
      { error: "Nama customer dan HP wajib diisi" },
      { status: 400 }
    );
  }

  // Auto-generate order number if not provided
  let orderNumber = id ? String(id).trim().toUpperCase() : "";
  if (!orderNumber) {
    try {
      orderNumber = await generateOrderNumber(supabase);
    } catch {
      return NextResponse.json(
        { error: "Gagal generate nomor order, coba lagi" },
        { status: 500 }
      );
    }
  }

  // Tahap awal pesanan baru = tahap pertama pada urutan produksi yang berlaku.
  const stepOrder = await loadStepOrder(supabase);

  const qtyNum = parseInt(quantity, 10);

  const insertData: Record<string, any> = {
    order_number: orderNumber,
    customer_name,
    customer_phone,
    product_type: product_name || "",
    quantity: isNaN(qtyNum) ? 1 : qtyNum,
    sizes: sizes || "",
    current_status: stepOrder[0],
    current_stage: 1,
    design_photos: design_photos || [],
    wo_photos: Array.isArray(wo_photos) ? wo_photos : [],
    products: Array.isArray(products) ? products : [],
  };
  if (material) insertData.material = material;
  if (deadline) insertData.deadline = deadline;
  if (created_at) insertData.created_at = created_at;

  const { data, error } = await supabase
    .from("orders")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Customer dapat kabar WA begitu pesanan disimpan, bukan cuma saat tahapnya
  // BERGESER. Sebelumnya pesanan baru yang masih di tahap 1 (Desain) tidak
  // pernah mengirim notifikasi apa pun, jadi pembeli baru tahu kabar setelah
  // operator memindahkan tahap.
  //
  // Anti-duplikat tetap dijaga `claim_stage_notification` (UNIQUE order_id+tahap),
  // jadi klik Simpan dua kali tidak mengirim WA dua kali.
  let notifStatus: NotificationTriggerStatus | "error" = "failed";
  try {
    notifStatus = await triggerStageNotification(
      supabase,
      data.id,
      {
        customer_name: data.customer_name,
        order_number: data.order_number,
        customer_phone: data.customer_phone,
      },
      1
    );
  } catch (e) {
    // Notifikasi gagal tidak boleh membatalkan pesanan yang sudah tersimpan.
    console.error("[orders] notifikasi tahap 1 gagal:", e);
    notifStatus = "error";
  }

  return NextResponse.json(
    {
      order: mapOrder(data, null, stepOrder),
      notification: { stage: 1, status: notifStatus },
    },
    { status: 201 }
  );
}
