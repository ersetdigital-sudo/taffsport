import { after, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/admin-auth";
import { removedCloudinaryUrls } from "@/lib/cloudinary";
import { destroyCloudinaryAssets } from "@/lib/cloudinary-server";
import { triggerMaklonStageNotification } from "@/lib/fonnte";
import {
  MAKLON_FINAL_STEP,
  clampMaklonStep,
  maklonStatusFromStep,
} from "@/lib/maklon-status";

// Notifikasi WA dikirim SETELAH respons (lihat `after` di bawah) dan Fonnte bisa
// butuh sampai 10 detik — function perlu ruang selama itu supaya kirimannya
// tidak ikut mati saat respons sudah terkirim.
export const maxDuration = 30;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Endpoint ini juga memicu notifikasi WhatsApp ke customer — wajib admin.
  const supabase = await getAdminDb();
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    current_step,
    note,
    courier,
    tracking_number,
    deadline,
    wo_photos,
    customer_name,
    customer_phone,
    design_photos,
  } = body;

  const { data: existing, error: fetchError } = await supabase
    .from("maklon_orders")
    .select("*")
    .eq("order_number", id)
    .maybeSingle();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Pesanan maklon tidak ditemukan" }, { status: 404 });
  }

  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (current_step !== undefined) {
    const newStage = clampMaklonStep(Number(current_step));
    updateData.current_stage = newStage;
    // Tahap akhir = maklon TUNTAS: status langsung "selesai", tanpa wajib nomor
    // resi. Resi/ekspedisi tetap opsional — kalau diisi, halaman tracking maklon
    // tetap menampilkan baris pengirimannya.
    if (newStage === MAKLON_FINAL_STEP) {
      updateData.current_status = "selesai";
    } else {
      updateData.current_status = maklonStatusFromStep(newStage);
    }
  }
  if (note !== undefined) updateData.design_notes = note;
  if (courier !== undefined) updateData.courier = courier;
  if (tracking_number !== undefined) updateData.tracking_number = tracking_number;
  if (deadline !== undefined) updateData.deadline = deadline || null;
  if (wo_photos !== undefined) updateData.wo_photos = Array.isArray(wo_photos) ? wo_photos : [];
  if (Array.isArray(body.products)) updateData.products = body.products;
  if (body.product_name !== undefined) updateData.product_type = body.product_name;
  if (body.quantity !== undefined) updateData.quantity = parseInt(body.quantity, 10) || 0;
  if (body.sizes !== undefined) updateData.sizes = body.sizes;
  if (body.material !== undefined) updateData.material = body.material || "";
  if (body.created_at !== undefined) updateData.created_at = body.created_at;
  if (customer_name !== undefined) updateData.customer_name = customer_name;
  if (customer_phone !== undefined) updateData.customer_phone = customer_phone;
  if (design_photos !== undefined) updateData.design_photos = Array.isArray(design_photos) ? design_photos : [];

  const { data: updatedOrder, error: updateError } = await supabase
    .from("maklon_orders")
    .update(updateData)
    .eq("order_number", id)
    .select("id")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Sama seperti pesanan jersey: foto yang dibuang operator dihapus dari
  // Cloudinary, dan hanya setelah update database berhasil.
  const removedPhotos = [
    ...removedCloudinaryUrls(
      existing.design_photos,
      updateData.design_photos ?? existing.design_photos
    ),
    ...removedCloudinaryUrls(
      existing.wo_photos,
      updateData.wo_photos ?? existing.wo_photos
    ),
  ];
  if (removedPhotos.length > 0) await destroyCloudinaryAssets(removedPhotos);

  if (current_step !== undefined && updatedOrder) {
    // History harus sama persis dengan status yang tersimpan
    // (tahap akhir = "selesai").
    const statusValue = updateData.current_status ?? maklonStatusFromStep(Number(current_step));
    await supabase.from("maklon_status_history").insert({
      order_id: updatedOrder.id,
      status: statusValue,
      note: note || "",
    });
  }

  const previousStage = existing.current_stage ?? null;
  const newStage = current_step !== undefined ? clampMaklonStep(Number(current_step)) : null;
  const notification: { stage: number | null; status: string } = { stage: newStage, status: "none" };

  if (updatedOrder && newStage !== null && newStage !== previousStage) {
    // "queued" = sudah antre dikirim, hasilnya belum diketahui. Toast di
    // dashboard menyebut ini apa adanya, bukan mengklaim "terkirim".
    notification.status = "queued";
    after(async () => {
      try {
        await triggerMaklonStageNotification(
          supabase,
          updatedOrder.id,
          {
            customer_name: existing.customer_name,
            order_number: existing.order_number,
            customer_phone: existing.customer_phone,
          },
          newStage
        );
      } catch (e) {
        console.error("[maklon/status] notifikasi tahap gagal:", e);
      }
    });
  } else if (newStage !== null && newStage === previousStage) {
    notification.status = "skipped_same_stage";
  }

  return NextResponse.json({ ok: true, notification });
}