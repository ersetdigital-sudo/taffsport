import type { Metadata } from "next";
import { getBrand } from "@/lib/queries";
import { loadStepOrder } from "@/lib/step-order-server";
import { TrackDetailClient } from "./TrackDetailClient";

export const metadata: Metadata = {
  title: "Lacak Pesanan",
  description: "Lacak progres pesanan jersey custom TAFF Sportwear",
};

interface TrackDetailPageProps {
  params: Promise<{ orderNumber: string }>;
}

// Nomor WhatsApp dibaca per request supaya tombol "Hubungi CS" di halaman ini
// selalu mengikuti menu Pengaturan admin, bukan nomor yang tertulis di kode.
export const dynamic = "force-dynamic";

export default async function TrackDetailPage({ params }: TrackDetailPageProps) {
  const { orderNumber } = await params;
  const [brand, stepOrder] = await Promise.all([getBrand(), loadStepOrder()]);

  return (
    <TrackDetailClient
      orderNumber={orderNumber}
      brand={{ name: brand.name, whatsapp_number: brand.whatsappNumber }}
      stepOrder={stepOrder}
    />
  );
}
