import PesananDashboard from "@/components/admin/PesananDashboard";
import { getAdminDb } from "@/lib/admin-auth";
import { loadDashboardOrders, type DashboardOrder } from "@/lib/pesanan-orders-server";

export const metadata = {
  // absolute: judul template root mengikuti nama brand di database, sesuai
  // keputusan pemilik toko. Panel admin di-override penuh supaya namanya tidak
  // ikut berubah kalau baris brand diedit dari menu Pengaturan.
  title: { absolute: "Kelola Pesanan · TAFF Sportwear" },
  description: "Dashboard admin kelola pesanan jersey custom",
};

/**
 * Dashboard Pesanan.
 *
 * Daftar pesanan dibaca di SERVER lalu dititipkan ke komponen client sebagai
 * data awal. Sebelumnya halaman ini mengirim HTML kosong, dan angka di kartu
 * KPI baru muncul setelah browser selesai memuat JS + memanggil
 * /api/pesanan/orders — jadi kartu sempat menampilkan 0 lebih dulu.
 *
 * Gagal baca (mis. belum login, database tidak bisa dihubungi) bukan error
 * halaman: komponen tetap dirender dengan data kosong dan nanti menyegarkan
 * sendiri dari browser. Halaman tanpa cookie sudah dicegat app/pesanan/layout.tsx.
 */
export default async function PesananPage() {
  let initialOrders: DashboardOrder[] = [];

  try {
    const db = await getAdminDb();
    if (db) initialOrders = await loadDashboardOrders(db);
  } catch (e) {
    // Jangan gagalkan render hanya karena data awal tidak terbaca.
    console.error("[pesanan] gagal memuat data awal:", e);
  }

  return <PesananDashboard initialOrders={initialOrders} />;
}
