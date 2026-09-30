import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { getBrand, getOperationalHours } from "@/lib/queries";
import { DEFAULT_PRODUCTS, productFamily } from "@/lib/product-options";
import { ORDER_STATUS_LABELS } from "@/lib/types";
import { loadStepOrder } from "@/lib/step-order-server";
import { formatWhatsAppDisplay, waMeUrl } from "@/lib/wa";

// Isi halaman dibaca per request: nama toko, nomor WhatsApp, dan jam operasional
// semuanya dari menu Pengaturan, jadi admin bisa mengubahnya tanpa deploy.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: `${brand.name} — ${brand.tagline.split("\n")[0]}`,
    description: brand.description,
  };
}

/** Keterangan singkat tiap keluarga produk (istilahnya sama dengan order form jersey). */
const FAMILY_INFO: Record<string, { unit: string }> = {
  Atasan: { unit: "Jersey saja · 1 pcs" },
  Setelan: { unit: "Atasan + celana · 1 set" },
};

/**
 * Beranda publik untuk customer.
 *
 * Sebelumnya halaman ini adalah portal admin (tombol "Masuk Dashboard Pesanan").
 * Sekarang isinya informasi toko + dua hal yang dicari customer: cara pesan dan
 * cara melacak pesanan. Pintu dashboard SENGAJA tidak ditautkan dari sini:
 * admin masuk langsung ke /login, supaya halaman publik tidak mengarahkan
 * pengunjung (atau bot) ke pintu masuk panel.
 *
 * Semua teks dinamis (nama, tagline, deskripsi, nomor WA, jam operasional) dan
 * daftar produk dibaca dari sumbernya masing-masing — tidak ada yang ditulis
 * ulang di berkas ini.
 */
export default async function HomePage() {
  // Urutan tahap dibaca dari tabel `production_steps` (bukan daftar di kode),
  // supaya bagian "Alur produksi" di landing page ikut saat admin menggeser
  // urutan di menu Pengaturan.
  const [brand, hours, stepOrder] = await Promise.all([
    getBrand(),
    getOperationalHours(),
    loadStepOrder(),
  ]);

  const waHref = waMeUrl(
    brand.whatsappNumber,
    `Halo ${brand.name}, saya mau tanya soal bikin jersey custom.`
  );
  const taglineLines = brand.tagline.split("\n").filter(Boolean);
  const families = ["Atasan", "Setelan"].map((family) => ({
    family,
    items: DEFAULT_PRODUCTS.filter((p) => productFamily(p) === family),
  }));
  const stages = stepOrder.map((s) => ORDER_STATUS_LABELS[s] ?? s);

  return (
    <div className="trk-bg min-h-screen">
      <div className="trk-grid min-h-screen">
        <div className="trk-glow min-h-screen">
          {/* ── Nav ─────────────────────────────────────────────────────── */}
          <header className="max-w-6xl mx-auto px-5 sm:px-8 py-5 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              {/* Versi kecil logo (192×224), bukan brand.logoPath.
                  brand.logoPath berisi berkas resolusi penuh yang ukurannya
                  3× lebih besar — terlalu berat untuk ditempel di header
                  setiap halaman. Nama toko tetap dirender sebagai teks di
                  sampingnya supaya ikut berubah dari menu Pengaturan. */}
              <Image
                src="/logo-taff-mark.png"
                alt=""
                aria-hidden="true"
                width={192}
                height={192}
                className="h-10 w-auto"
                priority
              />
              <span className="leading-none">
                <span className="block trk-display text-[15px] tracking-tight">
                  {brand.name}
                </span>
                <span className="block trk-stencil text-[9px] text-[#A3A3A3] mt-[3px]">
                  Custom Apparel
                </span>
              </span>
            </Link>

            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                href="/track"
                className="trk-btn-ghost px-4 py-2 text-[13px] font-semibold text-white"
              >
                Lacak Pesanan
              </Link>
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex trk-btn-ghost px-4 py-2 text-sm text-[#A3A3A3] hover:text-white"
              >
                Konsultasi
              </a>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-5 sm:px-8 pb-24">
            {/* ── Hero ──────────────────────────────────────────────────── */}
            <section className="max-w-3xl pt-6 sm:pt-10 lg:pt-14">
              <span className="inline-flex items-center gap-2 trk-stencil text-[10px] text-[#23BBB7] border border-[rgba(35, 187, 183,.35)] rounded-full px-3 py-1.5">
                Desain Bebas · Kirim se-Indonesia
              </span>

              <h1 className="trk-display text-[38px] leading-[1.03] sm:text-[58px] mt-5">
                {taglineLines[0] || "Jersey Custom Full Printing"}
                <span className="text-[#23BBB7]">.</span>
              </h1>

              {taglineLines[1] && (
                <p className="text-[#A3A3A3] text-[16px] sm:text-[17px] leading-relaxed mt-4">
                  {taglineLines.slice(1).join(" ")}
                </p>
              )}

              <div className="flex flex-col sm:flex-row gap-3 mt-8">
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="trk-btn-accent px-6 py-4 text-[14px] text-center"
                >
                  Konsultasi &amp; Pesan via WhatsApp
                </a>
                <Link
                  href="/track"
                  className="trk-btn-ghost px-6 py-4 text-[14px] font-semibold text-white text-center"
                >
                  Lacak Pesanan Saya
                </Link>
              </div>
            </section>

            {/* ── Produk ────────────────────────────────────────────────── */}
            <section className="mt-16 sm:mt-20">
              <h2 className="trk-display text-[24px] sm:text-[30px]">
                Yang bisa kami buat
              </h2>
              <p className="text-[#A3A3A3] text-[14.5px] mt-2">
                Harga dan bahan menyesuaikan jumlah pesanan — konsultasi dulu
                lewat WhatsApp, gratis.
              </p>

              <div className="grid sm:grid-cols-2 gap-4 mt-6">
                {families.map(({ family, items }) => (
                  <div key={family} className="trk-card p-5 sm:p-6">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="trk-display text-[20px]">{family}</h3>
                      <span className="trk-stencil text-[9.5px] text-[#23BBB7]">
                        {FAMILY_INFO[family]?.unit}
                      </span>
                    </div>
                    <ul className="mt-4 flex flex-col gap-2.5">
                      {items.map((item) => (
                        <li
                          key={item}
                          className="flex items-center gap-2.5 text-[14px] text-[#D4D4D4]"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-[#23BBB7] shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Tahap produksi ────────────────────────────────────────── */}
            <section className="mt-16 sm:mt-20">
              <h2 className="trk-display text-[24px] sm:text-[30px]">
                {stages.length} tahap produksi, bisa dipantau
              </h2>
              <p className="text-[#A3A3A3] text-[14.5px] mt-2">
                Setiap tahap selesai, kami kirim update otomatis ke WhatsApp-mu.
              </p>

              <ol className="flex flex-wrap gap-2 mt-6">
                {stages.map((label, i) => (
                  <li
                    key={label}
                    className="trk-btn-ghost px-3.5 py-2 text-[12.5px] text-[#D4D4D4]"
                  >
                    <span className="trk-stencil text-[9px] text-[#5C5C5C] mr-1.5">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {label}
                  </li>
                ))}
              </ol>
            </section>

            {/* ── Cara lacak ────────────────────────────────────────────── */}
            <section className="mt-16 sm:mt-20">
              <div className="trk-card p-6 sm:p-8">
                <h2 className="trk-display text-[24px] sm:text-[28px]">
                  Sudah pesan? Pantau sendiri, kapan saja
                </h2>
                <div className="grid sm:grid-cols-3 gap-5 mt-6">
                  {[
                    {
                      n: "01",
                      t: "Buka halaman Lacak",
                      d: "Tanpa login, cukup buka halaman pelacakan.",
                    },
                    {
                      n: "02",
                      t: "Isi nomor pesanan + HP",
                      d: "Nomor pesanan ada di struk atau pesan WhatsApp kami.",
                    },
                    {
                      n: "03",
                      t: "Lihat progresnya",
                      d: "Tahap aktif, riwayat, dan estimasi kirim tampil lengkap.",
                    },
                  ].map((step) => (
                    <div key={step.n}>
                      <span className="trk-stencil text-[10px] text-[#23BBB7]">
                        {step.n}
                      </span>
                      <p className="text-[15px] font-semibold text-white mt-1.5">
                        {step.t}
                      </p>
                      <p className="text-[13px] text-[#A3A3A3] leading-relaxed mt-1">
                        {step.d}
                      </p>
                    </div>
                  ))}
                </div>
                <Link
                  href="/track"
                  className="trk-btn-accent inline-block mt-7 px-6 py-3.5 text-[13px]"
                >
                  Lacak Pesanan
                </Link>
              </div>
            </section>
          </main>

          {/* ── Footer ──────────────────────────────────────────────────── */}
          <footer className="border-t border-[#2E2E2E] mt-auto">
            <div className="max-w-6xl mx-auto px-5 sm:px-8 py-7 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
              <div className="flex flex-col">
                <p className="text-[13px] text-[#A3A3A3]">
                  © {new Date().getFullYear()} {brand.name}
                </p>
              </div>
              <div className="flex flex-col sm:items-end gap-1 text-[13px] text-[#5C5C5C]">
                {/* Jam operasional dari menu Pengaturan, bukan teks tetap */}
                <span>{hours}</span>
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#23BBB7] hover:underline underline-offset-4"
                >
                  WhatsApp: {formatWhatsAppDisplay(brand.whatsappNumber)}
                </a>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
