import type { Metadata } from "next";
import { getBrand, getOperationalHours } from "@/lib/queries";
import TrackForm from "./TrackForm";

export const metadata: Metadata = {
  title: "Lacak Pesanan",
  description:
    "Lacak progres pesanan jersey custom TAFF Sportwear dengan nomor pesanan dan nomor HP.",
};

// Identitas toko dibaca per request supaya nomor WhatsApp di halaman ini selalu
// sama dengan yang diisi di menu Pengaturan admin.
export const dynamic = "force-dynamic";

export default async function TrackPage() {
  const [brand, hours] = await Promise.all([getBrand(), getOperationalHours()]);

  return (
    <TrackForm
      brand={{ name: brand.name, whatsapp_number: brand.whatsappNumber }}
      hours={hours}
    />
  );
}
