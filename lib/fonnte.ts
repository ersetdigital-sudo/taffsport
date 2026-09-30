/**
 * Integrasi notifikasi WhatsApp via Fonnte API.
 *
 * - Satu fungsi template untuk SEMUA tahap (bukan 9 template terpisah).
 * - Token diambil dari tabel `app_settings`, didekripsi SERVER-SIDE
 *   (lib/fonnte-crypto), dan TIDAK PERNAH dikirim ke client/browser.
 * - Nomor HP dinormalisasi + divalidasi sebelum dikirim (lihat lib/wa.ts).
 */

import { normalizeWhatsAppNumber } from "@/lib/wa";
import { decryptSecret } from "@/lib/fonnte-crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { signTrackingToken } from "@/lib/verify-token";
import { stageLabel } from "@/lib/order-status";
import { maklonLabelFromStep } from "@/lib/maklon-status";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppUrl } from "@/lib/app-url";
import { loadStepOrder, type StepOrder } from "@/lib/step-order-server";

export const FONNTE_TOKEN_KEY = "fonnte_token";
export const FONNTE_API_URL = "https://api.fonnte.com/send";
export const FONNTE_TIMEOUT_MS = 10_000;

// Daftar nama tahap TIDAK ditulis ulang di file ini. Sumbernya:
//   * pesanan jersey → lib/order-status.ts (`stageLabel`, `STATUS_TO_STAGE`)
//   * pesanan maklon → lib/maklon-status.ts (`maklonLabelFromStep`)
// Dengan begitu template pesan WhatsApp tidak bisa ketinggalan saat tahap
// produksi diubah.

/**
 * URL tracking publik (encode nomor pesanan bila ada karakter spesial).
 *
 * Token opsional (HMAC, masa berlaku pendek — lihat TRACKING_LINK_TTL_MS di
 * lib/verify-token.ts) membuat customer bisa langsung lihat progres TANPA
 * verifikasi HP. Karena token ini ikut terkirim di chat dan bisa diteruskan ke
 * siapa pun, masa berlakunya sengaja pendek dan penggunaannya dipantau per IP
 * (lib/track-guard.ts).
 */
export function buildTrackingUrl(orderNumber: string, token?: string): string {
  const base = `${getAppUrl()}/status?order=${encodeURIComponent(orderNumber)}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

/**
 * URL tracking publik khusus pesanan MAKLON.
 * Halaman /status sendiri cuma mengenal tabel `orders` (jersey), jadi maklon
 * punya halaman + token sendiri di /status/maklon.
 */
export function buildMaklonTrackingUrl(orderNumber: string, token?: string): string {
  const base = `${getAppUrl()}/status/maklon?order=${encodeURIComponent(orderNumber)}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

/**
 * Satu fungsi template untuk semua tahap.
 * - Tahap 1-10: template umum "UPDATE PESANAN".
 * - Tahap 11: template khusus "PESANAN DIKIRIM".
 * Tanpa emoji, bahasa Indonesia natural, hanya tahap aktif (tanpa daftar 11 tahap).
 */
export function buildWhatsAppMessage(
  stage: number,
  order: { customer_name: string; order_number: string },
  token?: string,
  stepOrder?: StepOrder
): string {
  const customerName = order.customer_name;
  const orderNumber = order.order_number;
  const trackingUrl = buildTrackingUrl(orderNumber, token);

  if (stage === 11) {
    return [
      "PESANAN DIKIRIM",
      `Halo Kak ${customerName},`,
      "",
      `Pesanan #${orderNumber} sudah selesai diproduksi dan sudah masuk tahap pengiriman.`,
      "",
      "Cek detail pesanan dan informasi pengiriman di:",
      trackingUrl,
      "",
      // Link memuat token yang membuka data pesanan — ingatkan customer supaya
      // tidak meneruskannya ke grup/umum (lihat lib/track-guard.ts).
      "Catatan: link ini khusus untuk Kakak, mohon tidak dibagikan ke grup/umum ya.",
      "",
      "Terima kasih sudah mempercayakan pesanan Kakak kepada TAFF Sportwear.",
    ].join("\n");
  }

  const stageName = stageLabel(stage, stepOrder);

    return [
      "UPDATE PESANAN",
      `Halo Kak ${customerName},`,
      "",
      `Pesanan #${orderNumber} saat ini sudah masuk tahap:`,
      `*${stageName}*`,
      "",
      `Progress: ${stage}/11 tahap`,
      "",
      "Cek progres lengkap pesanan Kakak di:",
      trackingUrl,
      "",
      "Kami akan mengirimkan update kembali saat pesanan masuk ke tahap berikutnya.",
      "",
      // Link memuat token yang membuka data pesanan — ingatkan customer supaya
      // tidak meneruskannya ke grup/umum (lihat lib/track-guard.ts).
      "Catatan: link ini khusus untuk Kakak, mohon tidak dibagikan ke grup/umum ya.",
      "",
      "Terima kasih sudah mempercayakan pesanan Kakak kepada TAFF Sportwear.",
    ].join("\n");
}

/**
 * Template WhatsApp untuk update tahap Maklon (1-6).
 * Tahap 6 (Kirim) memakai template khusus; lainnya template umum.
 */
export function buildMaklonWhatsAppMessage(
  stage: number,
  order: { customer_name: string; order_number: string },
  token?: string
): string {
  const customerName = order.customer_name;
  const orderNumber = order.order_number;
  const trackingUrl = buildMaklonTrackingUrl(orderNumber, token);

  if (stage === 6) {
    return [
      "MAKLON DIKIRIM",
      `Halo Kak ${customerName},`,
      "",
      `Pesanan maklon #${orderNumber} sudah selesai diproduksi dan masuk tahap pengiriman.`,
      "",
      "Cek detail pesanan di:",
      trackingUrl,
      "",
      // Link memuat token yang membuka data pesanan — ingatkan customer supaya
      // tidak meneruskannya ke grup/umum (lihat lib/track-guard.ts).
      "Catatan: link ini khusus untuk Kakak, mohon tidak dibagikan ke grup/umum ya.",
      "",
      "Terima kasih sudah mempercayakan pesanan Kakak kepada TAFF Sportwear.",
    ].join("\n");
  }

  const stageName = maklonLabelFromStep(stage);

  return [
    "UPDATE MAKLON",
    `Halo Kak ${customerName},`,
    "",
    `Pesanan maklon #${orderNumber} saat ini sudah masuk tahap:`,
    `*${stageName}*`,
    "",
    `Progress: ${stage}/6 tahap`,
    "",
    "Cek progres lengkap di:",
    trackingUrl,
    "",
    "Kami akan mengirimkan update kembali saat pesanan masuk ke tahap berikutnya.",
    "",
    // Link memuat token yang membuka data pesanan — ingatkan customer supaya
    // tidak meneruskannya ke grup/umum (lihat lib/track-guard.ts).
    "Catatan: link ini khusus untuk Kakak, mohon tidak dibagikan ke grup/umum ya.",
    "",
    "Terima kasih sudah mempercayakan pesanan Kakak kepada TAFF Sportwear.",
  ].join("\n");
}

/** Validasi nomor HP format internasional Fonnte (628xxxxxxxxxx). */
export function isValidFonntePhone(phone: string): boolean {
  return /^62\d{8,14}$/.test(phone);
}

/**
 * Ambil token Fonnte dari app_settings, didekripsi server-side.
 * Return null bila belum disimpan. TIDAK pernah di-log.
 */
export async function getFonnteToken(): Promise<string | null> {
  // Service role: RPC get_app_setting_value sudah tidak bisa dipanggil anon
  // (lihat migrasi 0005). Nilai tetap ciphertext — didekripsi di sini.
  const supabase = createServiceClient();
  const { data } = await supabase.rpc("get_app_setting_value", {
    p_key: FONNTE_TOKEN_KEY,
  });

  if (!data) return null;

  try {
    return decryptSecret(String(data));
  } catch {
    // Key berubah / data korup — tidak di-log isinya, cukup return null.
    return null;
  }
}

/**
 * Kirim pesan WhatsApp via Fonnte API.
 * - Token diambil + didekripsi di server, dipakai sebagai header Authorization.
 * - Timeout 10 detik, error network ditangani try-catch.
 * - Return `{ success, response }` — response TIDAK pernah berisi token.
 *
 * PENTING — Fonnte membalas **HTTP 200** walau pesannya ditolak:
 *   { "reason": "invalid token", "status": false }
 * Jadi `res.ok` saja tidak cukup: dulu token invalid dianggap SUKSES, toast
 * dashboard bilang "WA terkirim", log ditulis `success`, dan
 * `last_notified_stage` ikut naik — padahal customer tidak menerima apa pun
 * dan tahap itu tidak akan dikirim ulang (dianggap sudah pernah).
 * Keberhasilan ditentukan oleh `status` di body, bukan status HTTP.
 */
export async function sendFonnteMessage(
  phone: string,
  message: string
): Promise<{ success: boolean; response: Record<string, unknown> }> {
  const token = await getFonnteToken();
  if (!token) {
    return {
      success: false,
      response: { error: "fonnte_token_not_set" },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FONNTE_TIMEOUT_MS);

  try {
    const res = await fetch(FONNTE_API_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ target: phone, message }),
      signal: controller.signal,
    });

    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // Response bukan JSON — pakai status code saja.
      body = { status_code: res.status };
    }

    // `status: false` (mis. "invalid token", "device disconnected") = GAGAL,
    // walau HTTP-nya 200. Kalau field-nya tidak ada, cukup andalkan HTTP.
    const accepted = res.ok && body.status !== false;

    return {
      success: accepted,
      response: { status_code: res.status, ...body },
    };
  } catch (err) {
    // AbortController → timeout; fetch error lain → network failure.
    const name = err instanceof Error ? err.name : "unknown";
    return {
      success: false,
      response: { error: name === "AbortError" ? "timeout" : "network_error" },
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Normalisasi + validasi satu paket untuk dipakai endpoint admin. */
export function normalizeAndValidatePhone(raw: string): string | null {
  const phone = normalizeWhatsAppNumber(raw);
  return isValidFonntePhone(phone) ? phone : null;
}

/** Hasil trigger notifikasi untuk response API. */
export type NotificationTriggerStatus =
  | "sent"
  | "failed"
  | "skipped_duplicate"
  | "log_error";

/**
 * Trigger satu pengiriman notifikasi WA — dipakai endpoint admin
 * (`/api/admin/orders/[id]/status`) dan dashboard Pesanan
 * (`/api/pesanan/orders/[id]/status`).
 *
 * 1. INSERT notification_logs (order_id, stage) — unique constraint di DB
 *    = anti-duplikat, aman walau ada race condition/request kembar.
 * 2. Insert sukses → build pesan → kirim Fonnte → update log
 *    (success/failed + response_payload) → update last_notified_stage
 *    HANYA jika sukses.
 *
 * Seluruh proses dibungkus try-catch: kegagalan kirim WA TIDAK pernah
 * dilempar ke atas (status order tetap tersimpan).
 */
export async function triggerMaklonStageNotification(
  supabase: SupabaseClient,
  orderId: string,
  order: {
    customer_name: string;
    order_number: string;
    customer_phone: string;
  },
  stage: number
): Promise<NotificationTriggerStatus> {
  const { data: logId, error: claimError } = await supabase.rpc(
    "claim_maklon_stage_notification",
    { p_order_id: orderId, p_stage: stage }
  );

  if (claimError) {
    console.error("claim_maklon_stage_notification failed:", claimError.message);
    return "log_error";
  }
  if (!logId) return "skipped_duplicate";

  try {
    const phone = normalizeAndValidatePhone(order.customer_phone);
    if (!phone) {
      await supabase.rpc("finish_maklon_stage_notification", {
        p_id: logId,
        p_status: "failed",
        p_response: { error: "invalid_phone" },
      });
      return "failed";
    }

    const message = buildMaklonWhatsAppMessage(
      stage,
      order,
      signTrackingToken(order.order_number)
    );
    const result = await sendFonnteMessage(phone, message);

    await supabase.rpc("finish_maklon_stage_notification", {
      p_id: logId,
      p_status: result.success ? "success" : "failed",
      p_response: result.response,
    });

    if (!result.success) return "failed";

    await supabase.rpc("mark_maklon_last_notified_stage", {
      p_order_id: orderId,
      p_stage: stage,
    });

    return "sent";
  } catch (err) {
    console.error(
      "Maklon WA notification failed:",
      err instanceof Error ? err.message : err
    );
    try {
      await supabase.rpc("finish_maklon_stage_notification", {
        p_id: logId,
        p_status: "failed",
        p_response: { error: "unexpected" },
      });
    } catch {
      // log adalah best effort
    }
    return "failed";
  }
}

export async function triggerStageNotification(
  supabase: SupabaseClient,
  orderId: string,
  order: {
    customer_name: string;
    order_number: string;
    customer_phone: string;
  },
  stage: number
): Promise<NotificationTriggerStatus> {
  // 1. Klaim slot lewat RPC SECURITY DEFINER (anti-duplikat di level DB,
  //    aman dari race condition). Return NULL = sudah pernah terkirim.
  const { data: logId, error: claimError } = await supabase.rpc(
    "claim_stage_notification",
    { p_order_id: orderId, p_stage: stage }
  );

  if (claimError) {
    // Error DB lain — catat tanpa menggagalkan update status.
    console.error("claim_stage_notification failed:", claimError.message);
    return "log_error";
  }
  if (!logId) return "skipped_duplicate";

  try {
    const phone = normalizeAndValidatePhone(order.customer_phone);
    if (!phone) {
      await supabase.rpc("finish_stage_notification", {
        p_id: logId,
        p_status: "failed",
        p_response: { error: "invalid_phone" },
      });
      return "failed";
    }

    // Urutan tahap dibaca dari tabel `production_steps`, bukan dari daftar di
    // kode — supaya pesan WA menyebut nama tahap yang SAMA dengan yang tampil
    // di dashboard setelah admin menggeser urutan di menu Pengaturan.
    const stepOrder = await loadStepOrder(supabase);
    const message = buildWhatsAppMessage(
      stage,
      order,
      signTrackingToken(order.order_number),
      stepOrder
    );
    const result = await sendFonnteMessage(phone, message);

    // Update status log (response_payload TIDAK pernah berisi token).
    await supabase.rpc("finish_stage_notification", {
      p_id: logId,
      p_status: result.success ? "success" : "failed",
      p_response: result.response,
    });

    if (!result.success) return "failed";

    // last_notified_stage hanya di-update kalau kirim sukses.
    await supabase.rpc("mark_last_notified_stage", {
      p_order_id: orderId,
      p_stage: stage,
    });

    return "sent";
  } catch (err) {
    // Kegagalan WA → status order tetap tersimpan, cukup log error.
    console.error(
      "WA notification failed:",
      err instanceof Error ? err.message : err
    );
    try {
      await supabase.rpc("finish_stage_notification", {
        p_id: logId,
        p_status: "failed",
        p_response: { error: "unexpected" },
      });
    } catch {
      // log adalah best effort
    }
    return "failed";
  }
}