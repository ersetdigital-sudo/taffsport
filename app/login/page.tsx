import type { Metadata } from "next";
import { getBrand } from "@/lib/queries";
import LoginForm from "./LoginForm";

/**
 * Judul sengaja tidak memakai `absolute`: dibiarkan ikut template root
 * (`%s · <nama brand>`) supaya nama toko di tab browser selalu mengikuti
 * database — dulu di-hardcode karena baris `brand` masih berisi nama lama.
 */
export const metadata: Metadata = { title: "Login" };

/**
 * Halaman login — server component yang tugasnya cuma satu: mengambil
 * identitas toko (nama, tagline, logo, nomor CS) dari database, lalu
 * menyerahkannya ke form di sisi klien.
 *
 * Dipisah begini supaya identitas toko tetap bisa diubah admin dari menu
 * Pengaturan tanpa menyentuh kode, dan supaya kredensial database tidak
 * pernah ikut ke bundle browser.
 */
export default async function LoginPage() {
  const brand = await getBrand();

  return <LoginForm brand={brand} />;
}
