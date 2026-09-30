import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminDb } from "@/lib/admin-auth";
import { getAppUrl } from "@/lib/app-url";
import { createServiceClient } from "@/lib/supabase/server";
import { sendFonnteMessage, normalizeAndValidatePhone } from "@/lib/fonnte";
import { ORDER_STATUS_LABELS } from "@/lib/types";
import { dateKeyID, formatLongDateID } from "@/lib/format-date";

// Route ini mengirim WA berurutan ke beberapa admin; tanpa durasi eksplisit,
// Vercel bisa mematikan function di tengah jalan (respons 500 "Gateway Timeout").
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * Ambil secret cron dari request. Dua bentuk diterima:
 *
 *  - `Authorization: Bearer <CRON_SECRET>` — inilah yang dikirim scheduler
 *    eksternal (cron-job.org) begitu env `CRON_SECRET` di-set di Vercel.
 *    Tanpa menerima header ini, pemanggilan cron selalu ditolak 401 dan
 *    notifikasi tidak pernah jalan.
 *  - `x-cron-secret` atau `?secret=` — untuk pemanggilan manual: curl, "Test
 *    now" di dashboard cron-job.org, GitHub Actions, atau scheduler lain.
 *
 * Dulu hanya bentuk kedua yang diterima, jadi jadwal cron otomatis tidak akan
 * pernah lolos autentikasi.
 */
function readCronSecret(req: Request, url: URL): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();
  return req.headers.get("x-cron-secret") || url.searchParams.get("secret");
}

/** Semua setting yang dibutuhkan, dibaca lewat SATU query. */
const SETTING_KEYS = [
  "deadline_notif_enabled",
  "deadline_notif_time",
  "deadline_notif_days",
  "deadline_notif_phones",
  "deadline_notif_last_sent_date",
];

/**
 * Baca app_settings dengan 1x percobaan ulang.
 * Supabase sesekali membalas 504 sesaat ("Gateway Timeout") — dulu itu langsung
 * bikin seluruh run cron gagal di query pertama, padahal tinggal diulang.
 */
async function readSettings(
  supabase: SupabaseClient
): Promise<{ settings: { key: string; value: string | null }[]; error: string | null }> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", SETTING_KEYS);

    if (!error) return { settings: (data ?? []) as any, error: null };

    lastError = error.message || "unknown_error";
    console.error(`deadline-notif: app_settings gagal (percobaan ${attempt}):`, lastError);
    if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
  }

  return { settings: [], error: lastError };
}

/** Get current time in WIB (Asia/Jakarta, UTC+7) using Intl */
function getWibNow(): { hours: number; minutes: number; iso: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hours = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minutes = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  return { hours, minutes, iso };
}

export async function POST(req: Request) {
  return GET(req);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secretValue = readCronSecret(req, url);
  const cronSecretOk = Boolean(CRON_SECRET) && secretValue === CRON_SECRET;

  // Dua jalur masuk yang sah:
  //  - Scheduler eksternal (cron-job.org), dibuktikan dengan CRON_SECRET.
  //  - Tombol "kirim sekarang" di dashboard, dibuktikan cookie admin.
  //
  // Sebelumnya ceknya `!fromDashboard` dari header `x-from-dashboard`, dan
  // header itu bisa dikirim siapa pun — jadi orang luar bisa memicu kirim WA.
  const supabase = cronSecretOk ? createServiceClient() : await getAdminDb();

  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Dipertahankan dari versi lama: jalur dashboard (trigger manual) melewati
  // gerbang "sudah kirim hari ini" dan tidak menulis flag tanggal.
  const fromDashboard = !cronSecretOk;

  // 1. Ambil semua setting notif sekaligus (termasuk flag last_sent_date)
  const { settings, error: settingsErr } = await readSettings(supabase);

  if (settingsErr) {
    // Gangguan sesaat di upstream, bukan kesalahan konfigurasi — 503 supaya
    // cron berikutnya retry, dengan pesan yang jelas (bukan 500 tanpa konteks).
    return NextResponse.json(
      {
        error: settingsErr,
        message:
          "Gagal membaca pengaturan notifikasi dari database (gangguan sesaat). Coba jalankan ulang.",
      },
      { status: 503 }
    );
  }

  const get = (key: string) => settings.find((s) => s.key === key)?.value || null;

  const enabled = get("deadline_notif_enabled") === "true";
  const time = get("deadline_notif_time") || "08:00";
  const daysStr = get("deadline_notif_days") || "3,2,1";
  const phonesStr = get("deadline_notif_phones") || "";
  let lastSentDate: string | null = get("deadline_notif_last_sent_date");

  const wib = getWibNow();
  const [cfgH, cfgM] = time.split(":").map(Number);
  const currentMinutes = wib.hours * 60 + wib.minutes;
  const targetMinutes = cfgH * 60 + cfgM;
  const todayWib = wib.iso.slice(0, 10);
  const nowStr = `${String(wib.hours).padStart(2, "0")}:${String(wib.minutes).padStart(2, "0")}`;

  // Cek enabled, window waktu (>= jam setting), & flag sudah kirim hari ini
  if (!fromDashboard) {
    if (!enabled) {
      return NextResponse.json({ message: "Notifikasi deadline dinonaktifkan" });
    }

    if (lastSentDate === todayWib) {
      return NextResponse.json({
        message: "Sudah terkirim hari ini",
        debug: {
          sekarang: `${nowStr} WIB`,
          setting: `${time} WIB`,
          last_sent_date: lastSentDate,
        },
      });
    }

    // Window, bukan exact match: kirim kalau sudah lewat/pas jam setting
    if (currentMinutes < targetMinutes) {
      return NextResponse.json({
        message: `Belum waktunya. Setting: ${time} WIB, sekarang: ${nowStr} WIB`,
        debug: {
          sekarang: `${nowStr} WIB`,
          setting: `${time} WIB`,
          last_sent_date: lastSentDate,
        },
      });
    }
  }

  const overridePhones = req.headers.get("x-override-phones");
  const effectivePhonesStr = overridePhones ?? phonesStr;
  const days = daysStr.split(",").map(Number).filter((d: number) => d >= 0);
  const phones = effectivePhonesStr.split(",").map((p: string) => p.trim()).filter(Boolean);

  if (phones.length === 0) {
    return NextResponse.json({ error: "Nomor HP admin belum diatur" }, { status: 400 });
  }

  // 2. Cari order dengan deadline mendekati
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: orders, error: ordersErr } = await supabase
    .from("orders")
    .select(`
      id, order_number, customer_name, customer_phone,
      current_status, current_stage,
      deadline, products, quantity, product_type,
      deadline_notified_at
    `)
    .not("deadline", "is", null);

  if (ordersErr) {
    return NextResponse.json(
      {
        error: ordersErr.message || "unknown_error",
        message:
          "Gagal membaca daftar pesanan dari database (gangguan sesaat). Coba jalankan ulang.",
      },
      { status: 503 }
    );
  }

  const toNotify: any[] = [];
  const skippedOrders: any[] = [];
  for (const order of orders) {
    if (order.current_status === "selesai") continue;

    // Dedup per order: skip kalau sudah dinotif di tanggal WIB yang sama
    if (!fromDashboard && order.deadline_notified_at) {
      const notifiedWibDate = dateKeyID(order.deadline_notified_at);
      if (notifiedWibDate === todayWib) {
        skippedOrders.push({ order: order.order_number, reason: "sudah_dinotif_hari_ini" });
        continue;
      }
    }

    const deadlineDate = new Date(order.deadline);
    deadlineDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil(
      (deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (days.includes(diffDays) && diffDays >= 0) {
      toNotify.push({ ...order, diffDays });
    }
  }

  if (toNotify.length === 0) {
    return NextResponse.json({
      message: skippedOrders.length > 0
        ? "Semua order yang mendekati deadline sudah dinotif hari ini, dilewati"
        : "Tidak ada order yang mendekati deadline",
      total_orders: 0,
      sent_orders: [],
      skipped_orders: skippedOrders,
      debug: {
        sekarang: `${nowStr} WIB`,
        setting: `${time} WIB`,
        last_sent_date: lastSentDate,
      },
    });
  }

  // 3. Kirim WA ke semua admin + dedup + tracking.
  //    Pengiriman per nomor dijalankan PARALEL: 3 admin × (kirim + retry 2 detik)
  //    secara berurutan gampang lewat batas durasi function. Ada juga budget
  //    waktu supaya retry tidak menembus maxDuration.
  const results: any[] = [];
  const notifiedOrderIds: string[] = [];
  const startedAt = Date.now();
  const SEND_BUDGET_MS = 45_000;

  for (const order of toNotify) {
    const stageName =
      ORDER_STATUS_LABELS[order.current_status as keyof typeof ORDER_STATUS_LABELS] ||
      `Tahap ${order.current_stage}`;
    const product = order.products?.length
      ? order.products[0].name
      : order.product_type || "-";
    const qty = order.products?.length
      ? order.products.reduce(
          (a: number, p: any) =>
            a + p.sizes.reduce((x: number, s: any) => x + (s.qty || 0), 0),
          0
        )
      : order.quantity || "-";

    const message = `⚠️ PERINGATAN DEADLINE PESANAN

Halo Admin,

Pesanan berikut mendekati deadline:

Nomor: ${order.order_number}
Customer: ${order.customer_name}
Produk: ${product} (${qty} pcs)
Tahap: ${stageName} (${order.current_stage}/11)
Deadline: ${formatLongDateID(order.deadline)} (WIB)
Sisa: ${order.diffDays === 0 ? "Hari ini" : order.diffDays + " hari lagi"}

Segera tindak lanjuti.

Link: ${getAppUrl()}/pesanan/orders
---
Pesan ini dikirim otomatis oleh sistem.`;

    const perPhone = await Promise.all(
      phones.map(async (phone: string) => {
        const normalized = normalizeAndValidatePhone(phone);
        if (!normalized) {
          return { order: order.order_number, phone, status: "invalid_phone" };
        }

        // Retry: max 2 attempts, hanya kalau budget waktu masih ada
        let result = await sendFonnteMessage(normalized, message);
        if (!result.success && Date.now() - startedAt < SEND_BUDGET_MS) {
          await new Promise((r) => setTimeout(r, 2000));
          result = await sendFonnteMessage(normalized, message);
        }

        // Log to notification_logs (best effort: gagal nulis log TIDAK boleh
        // membatalkan hasil kirim yang sebenarnya sudah sukses)
        try {
          await supabase.from("notification_logs").insert({
            order_id: order.id,
            order_number: order.order_number,
            phone: normalized,
            status: result.success ? "sent" : "failed",
            error: result.success ? null : result.response || "Unknown error",
            diff_days: order.diffDays,
          });
        } catch (err) {
          console.error(
            "deadline-notif: gagal menulis notification_logs:",
            err instanceof Error ? err.message : err
          );
        }

        return {
          order: order.order_number,
          phone: normalized,
          status: result.success ? "sent" : "failed",
          response: result.response,
        };
      })
    );

    results.push(...perPhone);

    // Dedup: record setelah berhasil kirim (skip untuk test dashboard)
    if (perPhone.some((r) => r.status === "sent") && !fromDashboard) {
      notifiedOrderIds.push(order.id);
    }
  }

  // Batch update deadline_notified_at (dedup tracking)
  if (notifiedOrderIds.length > 0) {
    const nowIso = new Date().toISOString();
    try {
      await supabase
        .from("orders")
        .update({ deadline_notified_at: nowIso })
        .in("id", notifiedOrderIds);

      // Tandai tanggal terakhir kirim (cegah dobel kirim di hari yang sama)
      if (!fromDashboard) {
        await supabase
          .from("app_settings")
          .upsert(
            { key: "deadline_notif_last_sent_date", value: todayWib },
            { onConflict: "key" }
          );
      }
    } catch (err) {
      // WA sudah terkirim; kegagalan mencatat flag dedup cukup dilaporkan supaya
      // admin tahu ada kemungkinan notif yang sama terulang.
      console.error(
        "deadline-notif: gagal mencatat dedup deadline_notified_at:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return NextResponse.json({
    message: "Notifikasi deadline terkirim",
    total_orders: toNotify.length,
    sent_orders: notifiedOrderIds,
    skipped_orders: skippedOrders,
    debug: {
      sekarang: `${nowStr} WIB`,
      setting: `${time} WIB`,
      last_sent_date: notifiedOrderIds.length > 0 ? todayWib : lastSentDate,
    },
    results,
  });
}
