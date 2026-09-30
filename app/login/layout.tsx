/**
 * Metadata halaman login.
 *
 * Dipisah ke layout karena app/login/page.tsx adalah client component
 * ("use client"), dan Next.js tidak mengizinkan export `metadata` dari sana.
 *
 * `absolute` dipakai supaya judul tidak ikut template root
 * (`%s · <nama brand dari database>`) yang masih berisi nama brand lama.
 */
export const metadata = {
  title: { absolute: "Login · TAFF Sportwear" },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
