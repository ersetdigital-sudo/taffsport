import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTokenFromCookie } from "@/lib/verify-token";
import { clientIp } from "@/lib/track-guard";
import { loadStatusInitial } from "@/lib/status-server";
import StatusClient from "./StatusClient";

export const metadata: Metadata = {
  title: "Status Pesanan",
  description: "Pantau progres produksi pesanan jersey custom TAFF Sportwear.",
};

// Dibaca per request: token ada di query/cookie, jadi halaman ini tidak bisa
// di-cache sebagai halaman statis.
export const dynamic = "force-dynamic";

/**
 * Halaman ini sudah tidak menampilkan tombol WhatsApp/CS sama sekali, jadi
 * identitas toko (getBrand) tidak lagi dibaca di sini — satu query Supabase
 * lebih sedikit sebelum HTML pertama dikirim.
 *
 * Token diambil dari link WhatsApp (`?token=`) dulu; cookie perangkat jadi
 * cadangan supaya kunjungan ulang (bookmark/refresh tanpa query) tetap bisa
 * dirender di server. Kalau dua-duanya tidak ada, halaman dirender seperti
 * sebelumnya dan klien menampilkan modal verifikasi HP.
 */
export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; token?: string }>;
}) {
  const sp = await searchParams;
  const h = await headers();
  const token = sp.token || getTokenFromCookie(h.get("cookie"));
  const { data: initial, linkShared } = await loadStatusInitial(
    sp.order,
    token,
    clientIp(h)
  );

  return (
    <Suspense fallback={null}>
      <StatusClient initial={initial} initialLinkShared={linkShared} />
    </Suspense>
  );
}
