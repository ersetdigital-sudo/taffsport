import PesananDashboard from "@/components/admin/PesananDashboard";

export const metadata = {
  // absolute: judul template root mengikuti nama brand di database, sesuai
  // keputusan pemilik toko. Panel admin di-override penuh supaya namanya tidak
  // ikut berubah kalau baris brand diedit dari menu Pengaturan.
  title: { absolute: "Kelola Pesanan · TAFF Sportwear" },
  description: "Dashboard admin kelola pesanan jersey custom",
};

export default function PesananPage() {
  return <PesananDashboard />;
}
