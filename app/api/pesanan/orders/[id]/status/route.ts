import { after, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/admin-auth";
import { removedCloudinaryUrls } from "@/lib/cloudinary";
import { destroyCloudinaryAssets } from "@/lib/cloudinary-server";
import { triggerStageNotification, type NotificationTriggerStatus } from "@/lib/fonnte";
import { STATUS_TO_STAGE, statusFromStep } from "@/lib/order-status";
import { checkRateLimit } from "@/lib/rate-limit";
import { loadStepOrder } from "@/lib/step-order-server";

/**
 * PATCH /api/pesanan/orders/[id]/status — update tahap produksi dari
 * dashboard Pesanan (id = order_number).
 *
 * Sama seperti endpoint admin: notifikasi WA (Fonnte) dipicu HANYA bila
 * tahap BENAR-BENAR berubah, anti-duplikat lewat unique (order_id, stage) di
 * stage_notification_logs, dan kegagalan kirim WA tidak menggagalkan update
 * status.
 *
 * Notifikasi WA-nya dikirim lewat `after()`: kirim Fonnte bisa 10 detik dan
 * sebelumnya operator menunggu selama itu hanya untuk menyimpan satu tahap.
 */
export const maxDuration = 30;
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Endpoint ini memicu notifikasi WhatsApp ke customer, jadi WAJIB admin.
  const supabase = await getAdminDb();
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Urutan tahap dari tabel (bukan daftar di kode) — lihat lib/step-order.ts.
  const stepOrder = await loadStepOrder(supabase);

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
    // Foto progres tahap: URL foto untuk tahap yang dipilih, atau "" kalau
    // operator menghapusnya. `undefined` = operator tidak menyentuh foto tahap
    // ini, jadi foto yang sudah ada JANGAN diubah.
    stage_photo,
  } = body;

  // Rate limit dasar per order — cegah spam trigger notifikasi.
  if (!checkRateLimit(`stage-update:${id}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan, coba lagi nanti" },
      { status: 429 }
    );
  }

  // Ambil order dulu — previous_stage dibaca sebelum update, sekalian data
  // customer (nama, no. pesanan, no. HP) untuk pesan WhatsApp.
  const { data: existing, error: fetchError } = await supabase
    .from("orders")
    .select("*")
    .eq("order_number", id)
    .maybeSingle();

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: "Pesanan tidak ditemukan" },
      { status: 404 }
    );
  }

  const newStage =
    current_step !== undefined
      ? Math.min(Math.max(Number(current_step), 1), 11)
      : null;
  const previousStage =
    existing.current_stage ??
    STATUS_TO_STAGE[existing.current_status as string] ??
    null;

  // ── Pengaman anti-turun-tahap ────────────────────────────────────────────
  // Order yang sudah "selesai" nggak boleh keturunin tahapnya (atau balik jadi
  // "kirim") gara-gara client ngirim current_step yang basi/salah. Untuk membuka
  // ulang tahap produksinya secara sengaja, kirim `reopen: true`.
  const reopen = body.reopen === true;
  const isAlreadyDone = existing.current_status === "selesai";

  if (
    current_step !== undefined &&
    isAlreadyDone &&
    !reopen &&
    newStage !== null &&
    newStage < 11
  ) {
    return NextResponse.json(
      {
        error:
          "Pesanan ini sudah berstatus Selesai. Untuk membuka ulang tahap produksinya, kirim ulang permintaan dengan reopen: true.",
      },
      { status: 409 }
    );
  }

  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  // Status yang benar-benar tersimpan — dipakai juga untuk entri history.
  let effectiveStatus: string | null = null;

  if (current_step !== undefined) {
    updateData.current_stage = newStage;
    // Tahap akhir (11, "Kirim") = order TUNTAS: status langsung "selesai" dan
    // progress 100%. Nomor resi/ekspedisi jadi OPSIONAL — kalau admin mengisinya,
    // halaman customer tetap menampilkan tombol lacak; kalau kosong, customer
    // hanya melihat status "Selesai" tanpa blok pengiriman.
    // Order yang sudah selesai lalu di-save ulang di tahap akhir tetap "selesai",
    // kecuali `reopen: true` dikirim (satu-satunya jalan menurunkan tahap).
    const isFinalStage = newStage === stepOrder.length;
    const keepDone = isAlreadyDone && !reopen && isFinalStage;
    if (isFinalStage || keepDone) {
      effectiveStatus = "selesai";
    } else {
      effectiveStatus = statusFromStep(current_step, stepOrder);
    }
    updateData.current_status = effectiveStatus;
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
  if (body.created_at !== undefined) updateData.created_at = body.created_at;
  if (customer_name !== undefined) updateData.customer_name = customer_name;
  if (customer_phone !== undefined) updateData.customer_phone = customer_phone;
  if (design_photos !== undefined) updateData.design_photos = Array.isArray(design_photos) ? design_photos : [];

  // Use .update().select().single() to get the updated row back (including UUID id)
  const { data: updatedOrder, error: updateError } = await supabase
    .from("orders")
    .update(updateData)
    .eq("order_number", id)
    .select("id")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Foto yang benar-benar dibuang operator ikut dihapus dari Cloudinary, supaya
  // aset tidak menumpuk jadi file yatim dan kredit habis percuma. Perbandingan
  // memakai public_id, dan hanya dijalankan setelah update database berhasil —
  // kalau simpan gagal, foto lama masih dirujuk, jadi tidak boleh dihapus.
  // Kegagalan hapus tidak menggagalkan permintaan (lihat destroyCloudinaryAssets).
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

  // Insert history entry using the UUID from the updated row
  let historyError: string | null = null;
  if (current_step !== undefined && updatedOrder) {
    const statusValue = effectiveStatus ?? statusFromStep(current_step, stepOrder);

    // Foto progres tahap disimpan di baris history tahap itu (kolom
    // photo_url) — satu tahap menampilkan SATU foto, dan yang dipakai adalah
    // baris terakhir yang berisi foto (lihat halaman customer). Tidak perlu
    // kolom/tabel baru, jadi tidak ada migrasi.
    const historyRow: Record<string, any> = {
      order_id: updatedOrder.id,
      status: statusValue,
      note: note || "",
    };
    if (typeof stage_photo === "string" && stage_photo) historyRow.photo_url = stage_photo;

    const { error: histErr } = await supabase
      .from("order_status_history")
      .insert(historyRow);
    if (histErr) {
      historyError = histErr.message;
      console.error("History insert failed:", histErr.message, {
        order_id: updatedOrder.id,
        status: statusValue,
      });
    }

    // Operator menghapus foto tahap → kosongkan kolom photo_url di SEMUA baris
    // tahap ini. Kalau hanya baris baru yang dikosongkan, foto lama di baris
    // sebelumnya masih ikut tampil di halaman customer.
    if (!histErr && stage_photo === "") {
      const { error: clearErr } = await supabase
        .from("order_status_history")
        .update({ photo_url: "" })
        .eq("order_id", updatedOrder.id)
        .eq("status", statusValue);
      if (clearErr) console.error("Hapus foto tahap gagal:", clearErr.message);
    }
  }

  // Notifikasi WhatsApp — hanya bila tahap berubah.
  const notification: {
    stage: number | null;
    status: "none" | "skipped_same_stage" | "queued" | NotificationTriggerStatus;
  } = { stage: newStage, status: "none" };

  if (updatedOrder && newStage !== null && newStage !== previousStage) {
    // "queued" = sudah masuk antrean kirim, hasilnya belum diketahui. Toast di
    // dashboard menyebut ini apa adanya supaya operator tidak menyimpulkan
    // "terkirim" dari sesuatu yang belum tentu terkirim.
    notification.status = "queued";
    after(async () => {
      try {
        await triggerStageNotification(supabase, updatedOrder.id, existing, newStage);
      } catch (e) {
        console.error("[status] notifikasi tahap gagal:", e);
      }
    });
  } else if (newStage !== null && newStage === previousStage) {
    notification.status = "skipped_same_stage";
  }

  return NextResponse.json({ ok: true, historyError, notification });
}