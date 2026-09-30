import MaklonDashboard from "@/components/admin/MaklonDashboard";

export const metadata = {
  // Lihat catatan di app/pesanan/orders/page.tsx soal title absolute.
  title: { absolute: "Maklon · TAFF Sportwear" },
  description: "Dashboard admin kelola pesanan maklon",
};

export default function MaklonPage() {
  return <MaklonDashboard />;
}