import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Root middleware — sengaja SELF-CONTAINED (tanpa import alias `@/...`).
 *
 * Kenapa: middleware di-deploy sebagai berkas tersendiri, dan pada build
 * production berkas itu bisa di-emit mentah. Kalau dia mengimpor `@/lib/...`
 * (alias tsconfig), Node tidak bisa me-resolve-nya dan semua request gagal
 * dengan MIDDLEWARE_INVOCATION_FAILED. Karena itu logika session Supabase
 * ada langsung di sini, dan hanya mengimpor paket npm biasa (@supabase/ssr)
 * serta next/server.
 *
 * Yang dilakukan:
 *  1. Refresh session Supabase lewat cookie (supaya Server Component selalu
 *     membaca session terbaru tanpa hard reload).
 *  2. Menitipkan pathname ke header `x-pathname` supaya layout server
 *     (mis. app/pesanan/layout.tsx) tahu halaman apa yang sedang dibuka.
 *
 * CATATAN: middleware ini dulu juga menjaga rute `/admin/*` (login/signup),
 * warisan dari repo referensi. App ini tidak punya halaman `/admin` sama
 * sekali, jadi blok itu membingungkan dan sudah dihapus. Gerbang dashboard
 * yang sebenarnya ada di app/pesanan/layout.tsx (cookie `pesanan_auth`).
 */

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Simpan di variabel lokal supaya tipenya ter-narrow dengan benar.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase belum dikonfigurasi (mis. preview tanpa env var) — lewati
  // penanganan session supaya halaman tetap render dari data fallback.
  if (!supabaseUrl || !supabaseAnonKey) {
    const pathname = request.nextUrl.pathname;
    response.headers.set("x-pathname", pathname);
    return response;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() me-refresh token server-side. Jangan diganti getSession() —
  // itu cuma membaca JWT tanpa refresh. Hasilnya tidak dipakai di sini:
  // penjagaan rute dashboard ada di app/pesanan/layout.tsx.
  await supabase.auth.getUser();

  response.headers.set("x-pathname", request.nextUrl.pathname);

  return response;
}

export const config = {
  matcher: [
    /*
     * Semua path kecuali:
     * - _next/static, _next/image (aset internal)
     * - favicon, ikon app, & aset publik lain
     *
     * Pengecualian ini bukan cuma soal header: tiap request yang lolos matcher
     * memanggil Supabase `getUser()`. Tanpa daftar ini, tiap kali browser minta
     * favicon/logo kita bayar satu round-trip ke Supabase tanpa guna.
     */
    "/((?!_next/static|_next/image|favicon.ico|favicon.png|icon.png|apple-icon.png|logo.svg|logo-taff.png|logo-taff-mark.png|opengraph-image).*)",
  ],
};
