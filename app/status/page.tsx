import { Suspense } from "react";
import type { Metadata } from "next";
import { getBrand } from "@/lib/queries";
import StatusClient from "./StatusClient";

export const metadata: Metadata = {
  title: "Status Pesanan",
  description: "Pantau progres produksi pesanan jersey custom TAFF Sportwear.",
};

// Identitas toko dibaca per request: nomor WhatsApp untuk tombol CS harus sama
// dengan yang diisi di menu Pengaturan admin, termasuk di HTML pertama.
export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const brand = await getBrand();

  return (
    <Suspense fallback={null}>
      <StatusClient
        brand={{ name: brand.name, whatsapp_number: brand.whatsappNumber }}
      />
    </Suspense>
  );
}
