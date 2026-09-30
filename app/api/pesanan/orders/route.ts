import { after, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/admin-auth";
import { generateOrderNumber } from "@/lib/order-number";
import { loadDashboardOrders, mapOrder } from "@/lib/pesanan-orders-server";
import { loadStepOrder } from "@/lib/step-order-server";
import { triggerStageNotification } from "@/lib/fonnte";

// Notifikasi WA tahap 1 dikirim SETELAH respons (lihat `after` di POST), dan
// Fonnte bisa butuh sampai 10 detik. Tanpa durasi eksplisit, function bisa
// dimatikan di tengah jalan saat provider lambat — notifikasinya hilang
// padahal pesanannya sudah tersimpan.
export const maxDuration = 30;

export async function GET() {
  const supabase = await getAdminDb();
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ orders: await loadDashboardOrders(supabase) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Gagal memuat pesanan" }, { status: 500 });
  }
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
  //
  // Dijalankan lewat `after()` — bukan di-await di sini. Mengirim WA butuh
  // round-trip ke Fonnte (timeout 10 detik), dan operator tidak perlu menunggu
  // itu untuk melihat pesanannya masuk: tombol Simpan harus terasa instan.
  // `after()` menahan function tetap hidup sampai tugasnya selesai, jadi
  // notifikasi tidak ikut mati saat respons sudah dikirim.
  after(async () => {
    try {
      await triggerStageNotification(
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
    }
  });

  return NextResponse.json(
    {
      order: mapOrder(data, null, stepOrder),
      notification: { stage: 1, status: "queued" },
    },
    { status: 201 }
  );
}
