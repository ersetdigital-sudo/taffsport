/**
 * Pembacaan data halaman status pesanan JERSEY langsung di server (server-only).
 *
 * Kenapa ada: halaman /status dulu selalu kosong beberapa detik. HTML pertama
 * cuma memuat header, isi pesanan baru muncul setelah browser menyelesaikan
 * `/api/track/session` lalu `/api/track/ensure-history` — dua request berurutan
 * ke Supabase, masing-masing satu round trip.
 *
 * Kalau token dari link WhatsApp (`?token=`) atau cookie perangkat ada, datanya
 * dibaca di sini sehingga HTML pertama sudah berisi progres pesanan. Halaman
 * /status/maklon memang sudah bekerja seperti ini.
 *
 * Modul ini memakai service-role client, jadi TIDAK boleh diimpor komponen
 * client (bandingkan lib/step-order.ts vs lib/step-order-server.ts).
 */
import { createServiceClient } from "@/lib/supabase/server";
import { verifyToken } from "@/lib/verify-token";
import { isTokenSharedAcrossDevices } from "@/lib/track-guard";

export type StatusStep = { name: string; position: number };

export type StatusInitial = {
  order: Record<string, unknown>;
  history: Record<string, unknown>[];
  steps: StatusStep[];
};

export type StatusInitialResult = {
  /** `null` = token tidak ada/tidak sah → klien lanjut ke alur verifikasi HP. */
  data: StatusInitial | null;
  /** True kalau token ditolak karena dipakai dari banyak perangkat berbeda. */
  linkShared: boolean;
};

export async function loadStatusInitial(
  orderNumber: string | undefined,
  rawToken: string | null,
  ip: string
): Promise<StatusInitialResult> {
  const desired = (orderNumber || "").toUpperCase();
  if (!desired || !rawToken) return { data: null, linkShared: false };

  const session = verifyToken(rawToken);
  if (!session || session.orderId !== desired) return { data: null, linkShared: false };

  // Pengaman "link dibagikan" tetap berlaku di jalur SSR. Tanpa panggilan ini,
  // link yang diteruskan ke grup WhatsApp justru lolos di render server —
  // sidik jari perangkatnya hanya dihitung di /api/track/session.
  if (isTokenSharedAcrossDevices(rawToken, ip)) return { data: null, linkShared: true };

  try {
    const supabase = createServiceClient();

    const { data: orderRaw, error } = await supabase
      .from("orders")
      .select("*")
      .eq("order_number", desired)
      .single();

    if (error || !orderRaw) return { data: null, linkShared: false };

    const [{ data: history }, { data: stepRows }] = await Promise.all([
      supabase
        .from("order_status_history")
        .select("*")
        .eq("order_id", (orderRaw as { id: string }).id)
        .order("created_at", { ascending: true }),
      supabase
        .from("production_steps")
        .select("name, position")
        .order("position", { ascending: true }),
    ]);

    // `wo_photos` cuma untuk admin (dokumen kerja), jangan ikut ke browser
    // customer — sama seperti yang dilakukan /api/track/session.
    const { wo_photos: _wo, ...order } = orderRaw as Record<string, unknown> & {
      wo_photos?: unknown;
    };

    return {
      data: {
        order,
        history: (history ?? []) as Record<string, unknown>[],
        steps: (stepRows ?? []) as StatusStep[],
      },
      linkShared: false,
    };
  } catch (e) {
    // SSR tidak boleh menjatuhkan halaman: apa pun yang gagal di sini bikin
    // halaman jatuh ke alur klien seperti sebelumnya (dengan skeleton).
    console.error("[status] gagal memuat data awal di server:", e);
    return { data: null, linkShared: false };
  }
}
