"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatWhatsAppDisplay, waMeUrl } from "@/lib/wa";

/**
 * Form pelacakan (client component).
 *
 * Identitas toko — nama + nomor WhatsApp — datang sebagai PROP dari server
 * (`app/track/page.tsx` → getBrand()), bukan di-fetch dari browser. Dulu nomor
 * cadangan di-hardcode di sini, jadi HTML pertama yang dikirim ke customer
 * masih memuat nomor lama dan footer menampilkannya sebagai teks mati.
 */
export default function TrackForm({
  brand,
  hours,
}: {
  brand: { name: string; whatsapp_number: string };
  /** Jam operasional dari menu Pengaturan (dulu teks tetap di footer). */
  hours: string;
}) {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Nomor untuk link WA & tampilan, dua-duanya dari nilai yang sama
  const waHref = waMeUrl(brand.whatsapp_number);

  function showErr(msg: string) {
    setError(msg);
  }

  function clearErr() {
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearErr();
    setLoading(true);

    const id = orderNumber.trim().toUpperCase();

    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderNumber: id, phone }),
      });

      if (!res.ok) {
        showErr(
          "Nomor pesanan tidak ditemukan. Cek lagi formatnya (contoh: TAFF260907K4XQ) atau hubungi admin."
        );
        setLoading(false);
        return;
      }

      const data = await res.json();
      if (!data.order) {
        showErr("Nomor HP tidak cocok dengan pesanan ini. Gunakan nomor yang dipakai saat order.");
        setLoading(false);
        return;
      }

      // Store token separately for session header auth
      if (data.token) {
        sessionStorage.setItem(`taff_token_${id}`, data.token);
      }
      sessionStorage.setItem(`taff_verified_${id}`, JSON.stringify(data));
      router.push(`/status?order=${encodeURIComponent(id)}`);
    } catch {
      showErr("Terjadi kesalahan. Coba lagi.");
      setLoading(false);
    }
  }

  return (
    <div className="trk-bg min-h-screen">
      <div className="trk-grid min-h-screen">
        <div className="trk-glow min-h-screen">
          {/* nav */}
          <header className="max-w-6xl mx-auto px-5 sm:px-8 py-5 flex items-center justify-between">
            <a href="/" className="flex items-center gap-3">
{/* Mark saja (tanpa wordmark), karena teks TAFF Sportwear sudah ada di sampingnya */}
                <img
                  src="/logo-taff-mark.png"
                  alt=""
                  aria-hidden="true"
                  className="h-10 w-auto"
                />
              <span className="leading-none">
                <span className="block trk-display text-[15px] tracking-tight">
                  TAFF Sportwear
                </span>
                <span className="block trk-stencil text-[9px] text-[#A3A3A3] mt-[3px]">
                  Custom Apparel
                </span>
              </span>
            </a>
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex trk-btn-ghost px-4 py-2 text-sm text-[#A3A3A3] hover:text-white"
            >
              Hubungi Admin
            </a>
          </header>

          <main className="max-w-6xl mx-auto px-5 sm:px-8 pb-24">
            <div className="max-w-xl mx-auto flex flex-col gap-8 pt-6 sm:pt-10 lg:pt-14">
              {/* copy + form */}
              <section>
                <span className="inline-flex items-center gap-2 trk-stencil text-[10px] text-[#FF5A1F] border border-[rgba(255, 90, 31,.35)] rounded-full px-3 py-1.5">
                  Order Tracking
                </span>

                <h1 className="trk-display text-[40px] leading-[1.02] sm:text-[58px] mt-5">
                  Lacak Pesanan
                  <br />
                  Kamu<span className="text-[#FF5A1F]">.</span>
                </h1>

                <p className="text-[#A3A3A3] text-[16px] sm:text-[17px] leading-relaxed mt-4">
                  Pantau progres jersey custom kamu dari desain sampai siap
                  dikirim. Tanpa perlu login, cukup masukkan nomor pesanan dan
                  nomor HP yang dipakai saat order.
                </p>

                <form
                  id="trackForm"
                  onSubmit={handleSubmit}
                  className="trk-card p-5 sm:p-7 mt-8"
                >
                  <label className="block">
                    <span className="trk-stencil text-[10px] text-[#A3A3A3]">
                      Nomor Pesanan
                    </span>
                    <input
                      required
                      type="text"
                      value={orderNumber}
                      onChange={(e) => {
                        setOrderNumber(e.target.value);
                        clearErr();
                      }}
                      placeholder="TAFF260907K4XQ"
                      autoComplete="off"
                      className="trk-field w-full mt-2 px-4 py-3.5 text-[16px] tracking-wide"
                    />
                  </label>

                  <label className="block mt-5">
                    <span className="trk-stencil text-[10px] text-[#A3A3A3]">
                      Nomor HP
                    </span>
                    <input
                      required
                      type="tel"
                      inputMode="numeric"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        clearErr();
                      }}
                      placeholder="0812xxxxxxx"
                      autoComplete="off"
                      className="trk-field w-full mt-2 px-4 py-3.5 text-[16px] tracking-wide"
                    />
                    <span className="block text-[13px] text-[#5C5C5C] mt-2">
                      Dipakai hanya untuk verifikasi pemilik pesanan.
                    </span>
                  </label>

                  {error && (
                    <p className="mt-4 text-[13.5px] leading-relaxed rounded-xl border border-[rgba(255,59,47,.45)] bg-[rgba(255,59,47,.1)] text-[#ff8b83] px-4 py-3">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="trk-btn-accent w-full mt-6 py-4 text-[15px] flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {loading ? (
                      "Memverifikasi…"
                    ) : (
                      <>
                        Cek Pesanan
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </>
                    )}
                  </button>

                  <p className="text-[13px] text-[#5C5C5C] text-center mt-5">
                    Lupa nomor pesanan?{" "}
                    <a
                      href={waMeUrl(
                        brand.whatsapp_number,
                        `Halo ${brand.name}, saya lupa nomor pesanan saya`
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#FF5A1F] underline underline-offset-4"
                    >
                      Tanya admin
                    </a>
                  </p>
                </form>

                <div className="flex flex-wrap gap-x-7 gap-y-2 mt-7 text-[13px] text-[#A3A3A3]">
                  <span>11 tahap produksi transparan</span>
                  <span>Estimasi kirim jelas</span>
                  <span>Update tiap hari kerja</span>
                </div>
              </section>

              {/* stats */}
              <section>
                <div className="grid grid-cols-3 gap-3">
                  <div className="trk-card p-4 sm:p-5 text-center">
                    <p className="trk-display text-[20px] sm:text-[24px] text-[#FF5A1F]">
                      450K+
                    </p>
                    <p className="text-[12px] sm:text-[13px] text-[#A3A3A3] mt-1 leading-snug">
                      Order selesai
                    </p>
                  </div>
                  <div className="trk-card p-4 sm:p-5 text-center">
                    <p className="trk-display text-[20px] sm:text-[24px] text-[#FF5A1F]">
                      9K+
                    </p>
                    <p className="text-[12px] sm:text-[13px] text-[#A3A3A3] mt-1 leading-snug">
                      Tim &amp; klien
                    </p>
                  </div>
                  <div className="trk-card p-4 sm:p-5 text-center">
                    <p className="trk-display text-[20px] sm:text-[24px] text-[#FF5A1F]">
                      7–10
                    </p>
                    <p className="text-[12px] sm:text-[13px] text-[#A3A3A3] mt-1 leading-snug">
                      Hari kerja
                    </p>
                  </div>
                </div>
              </section>
            </div>
          </main>

          <footer className="border-t border-[#2E2E2E] mt-auto">
            <div className="max-w-6xl mx-auto px-5 sm:px-8 py-7 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
              <div className="flex flex-col">
                <p className="text-[13px] text-[#A3A3A3]">
                  © 2026 TAFF Sportwear — Custom Jersey &amp; Sportswear
                </p>
                <p className="trk-stencil text-[9px] text-[#5C5C5C] mt-0.5">
                  taffsport.id
                </p>
              </div>
              <div className="flex flex-col sm:items-end gap-1 text-[13px] text-[#5C5C5C]">
                <span>{hours}</span>
                <a
                  href={waHref}
                  className="text-[#FF5A1F] hover:underline underline-offset-4"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp: {formatWhatsAppDisplay(brand.whatsapp_number)}
                </a>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
