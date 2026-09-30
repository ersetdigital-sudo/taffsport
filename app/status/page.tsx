import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getBrand } from "@/lib/queries";
import { getTokenFromCookie } from "@/lib/verify-token";
import { clientIp } from "@/lib/track-guard";
import { loadStatusInitial } from "@/lib/status-server";
import StatusClient from "./StatusClient";

export const metadata: Metadata = {
  title: "Status Pesanan",
  description: "Pantau progres produksi pesanan jersey custom TAFF Sportwear.",
};

// Identitas toko dibaca per request: nomor WhatsApp untuk tombol CS harus sama
// dengan yang diisi di menu Pengaturan admin, termasuk di HTML pertama.
export const dynamic = "force-dynamic";

/**
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

  // Data pesanan dan identitas toko tidak saling bergantung → dijalankan
  // bersamaan supaya HTML pertama siap secepat mungkin.
  const [{ data: initial, linkShared }, brand] = await Promise.all([
    loadStatusInitial(sp.order, token, clientIp(h)),
    getBrand(),
  ]);

  return (
    <Suspense fallback={null}>
      <StatusClient
        brand={{ name: brand.name, whatsapp_number: brand.whatsappNumber }}
        initial={initial}
        initialLinkShared={linkShared}
      />
    </Suspense>
  );
}
