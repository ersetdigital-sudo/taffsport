import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { cookies } from "next/headers";

export default async function PesananLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "";

  // `/pesanan/login` sudah jadi rute lama yang cuma me-redirect ke `/login`,
  // tapi harus tetap dikecualikan dari cek cookie di bawah — kalau tidak,
  // pengguna tanpa cookie akan terjebak redirect ke halaman itu sendiri.
  const isLoginPage = pathname === "/pesanan/login";

  if (!isLoginPage) {
    const cookieStore = await cookies();
    const token = cookieStore.get("pesanan_auth")?.value;

    // Harus persis "true" — sama dengan cek di route handler & hasAdminAccess().
    // Sebelumnya cuma `!token`, jadi nilai cookie apa pun (mis. "asdf") lolos
    // di halaman tapi ditolak di API.
    if (token !== "true") {
      redirect("/login");
    }
  }

  return (
    <div className="min-h-screen bg-[#F5EFE3] text-[#0A0A0A]">{children}</div>
  );
}
