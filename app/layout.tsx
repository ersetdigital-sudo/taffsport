import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import { getAppUrl } from "@/lib/app-url";
import { getBrand } from "@/lib/queries";
import "./globals.css";

/**
 * Font — Archivo (satu keluarga untuk teks & display, sesuai brand TAFF Sportwear).
 * Berkasnya diambil dari folder `fonts/` di root repo, jadi tidak ada request ke
 * Google Fonts saat build maupun saat halaman dibuka.
 */
const archivo = localFont({
  src: [
    { path: "../fonts/archivo-regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/archivo-italic.ttf", weight: "400", style: "italic" },
    { path: "../fonts/archivo-medium.ttf", weight: "500", style: "normal" },
    { path: "../fonts/archivo-semibold.ttf", weight: "600", style: "normal" },
    { path: "../fonts/archivo-bold.ttf", weight: "700", style: "normal" },
    { path: "../fonts/archivo-extrabold.ttf", weight: "800", style: "normal" },
    { path: "../fonts/archivo-black.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

/**
 * JetBrains Mono — khusus nomor pesanan & label stencil seperti di mockup TAFF
 * (contoh: TNT260929YXUZ). Dikonsumsi lewat --font-mono di globals.css.
 * Berkas variable font-nya ikut di repo, sama seperti Archivo: build tidak
 * pernah menyentuh Google Fonts, jadi build di CI/Vercel tidak bisa gagal
 * karena masalah jaringan.
 */
const jetbrainsMono = localFont({
  src: "../fonts/jetbrains-mono-variable.ttf",
  weight: "100 800",
  style: "normal",
  display: "swap",
  variable: "--font-mono",
});

/**
 * Metadata dinamis — nama, tagline, dan deskripsi dibaca dari tabel `brand`
 * di Supabase, jadi admin bisa mengubahnya tanpa deploy ulang.
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const taglineFirstLine = brand.tagline.split("\n")[0];

  return {
    // Canonical = domain aplikasi ini sendiri, dibaca dari env Vercel.
    // Sebelumnya memakai `brand.url` (domain situs katalog), dan nilainya
    // ternyata sudah mati — jadi canonical/OG mengarah ke halaman 404.
    metadataBase: new URL(getAppUrl()),
    title: {
      default: `${brand.name} — Admin Panel`,
      template: `%s · ${brand.name}`,
    },
    description: brand.description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: "id_ID",
      url: getAppUrl(),
      siteName: brand.name,
      title: `${brand.name} — ${taglineFirstLine}`,
      description: brand.description,
    },
    twitter: {
      card: "summary_large_image",
      title: `${brand.name} — ${taglineFirstLine}`,
      description: brand.description,
    },
    // Panel operasional + halaman tracking customer: jangan diindeks.
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    },
    category: "business",
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5EFE3" },
    { media: "(prefers-color-scheme: dark)", color: "#050505" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" suppressHydrationWarning className={`${archivo.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
