import MaklonDashboard from "@/components/admin/MaklonDashboard";
import { getAdminDb } from "@/lib/admin-auth";
import { loadMaklonOrders, type MaklonDashboardOrder } from "@/lib/maklon-orders-server";

export const metadata = {
  // Lihat catatan di app/pesanan/orders/page.tsx soal title absolute.
  title: { absolute: "Maklon · TAFF Sportwear" },
  description: "Dashboard admin kelola pesanan maklon",
};

/**
 * Dashboard Maklon.
 *
 * Sama seperti dashboard Pesanan: daftar maklon dibaca di server lalu
 * dititipkan sebagai data awal, supaya tabel dan kartunya sudah berisi data di
 * HTML pertama — bukan "Memuat data..." dulu baru terisi.
 *
 * Gagal baca bukan error halaman: komponen tetap dirender kosong dan
 * menyegarkan sendiri dari browser. Halaman tanpa cookie sudah dicegat
 * app/pesanan/layout.tsx.
 */
export default async function MaklonPage() {
  let initialOrders: MaklonDashboardOrder[] = [];

  try {
    const db = await getAdminDb();
    if (db) initialOrders = await loadMaklonOrders(db);
  } catch (e) {
    // Jangan gagalkan render hanya karena data awal tidak terbaca.
    console.error("[maklon] gagal memuat data awal:", e);
  }

  return <MaklonDashboard initialOrders={initialOrders} />;
}
