"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";

import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_LIST,
  getProgress,
  type OrderStatus,
} from "@/lib/types";
import {
  STAGE_BACKFILL_NOTES,
  isOrderCompleted,
  normalizeOrderStatus,
  stepFromStatus,
  TOTAL_STAGES,
} from "@/lib/order-status";
import { formatShortDateID, formatShortDateTimeID, formatDeadlineNoteID } from "@/lib/format-date";
import { optimizeImageUrl } from "@/lib/cloudinary";
import { labelFromSlug, resolveStepOrder, type StepOrder } from "@/lib/step-order";

/**
 * Penyimpanan token di perangkat customer.
 *
 * `localStorage` = token hasil VERIFIKASI NOMOR HP (berlaku 30 hari) — inilah
 * yang membuat customer tidak perlu mengetik nomor HP tiap kali buka. Token
 * dari link WhatsApp sengaja hanya ditaruh di `sessionStorage`: link itu bisa
 * diteruskan ke siapa pun, jadi tidak layak "diingat" perangkat.
 *
 * Semua akses dibungkus try — localStorage bisa diblokir (mode privat / izin
 * situs), dan itu tidak boleh membuat halaman status gagal terbuka.
 */
function storedToken(key: string): string | null {
  try {
    const persisted = localStorage.getItem(key);
    if (persisted) return persisted;
  } catch {
    /* lanjut ke sessionStorage */
  }
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearStoredToken(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* diabaikan */
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* diabaikan */
  }
}

const CHECK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const SPIN_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"/></svg>';

// Format tanggal & jam ada di lib/format-date.ts dan selalu memakai zona
// Asia/Jakarta, jadi customer di WITA/WIT melihat jam yang sama dengan admin.

/** Format jumlah (qty) dengan pemisah ribuan ala Indonesia: 1000 → 1.000 */
function fmtQty(n: number): string {
  return n.toLocaleString("id-ID");
}

const SLUG_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(ORDER_STATUS_LABELS).map(([slug, label]) => [slug, label])
);
const LABEL_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(ORDER_STATUS_LABELS).map(([slug, label]) => [label.toLowerCase(), slug])
);

/**
 * Nama tahap dari database (`production_steps`) atau status lama → slug 11 tahap.
 * Alias slug lama (`print`, `pres`, `potong`) ditangani lib/order-status.ts,
 * jadi aturan konversinya cuma ada di satu tempat.
 */
function normalizeStepName(name: string): string {
  const lower = name.trim().toLowerCase();
  return LABEL_TO_SLUG[lower] || normalizeOrderStatus(lower);
}

/**
 * Tahap ke berapa untuk sebuah current_status.
 * Aturan "selesai" = tahap akhir & status tak dikenal = tahap 1 ada di
 * lib/order-status.ts (`isOrderCompleted` / `stepFromStatus`).
 *
 * Nomornya SELALU dari model kanonik 11 tahap, bukan dari posisi nama di tabel
 * `production_steps`. Dulu nomornya dicari di daftar nama itu — dan karena
 * isinya masih 9 nama versi lama ("Print", "Pres", "Potong"), customer melihat
 * "Tahap 3 / 9" (27%) untuk pesanan yang di dashboard sudah "tahap 4 / 11"
 * (36%). Tabel `production_steps` sekarang hanya menentukan LABEL tahap.
 */
function stepIndexFromStatus(status: string, order: StepOrder): number {
  if (isOrderCompleted(status)) return order.length;
  return stepFromStatus(status, order);
}

/**
 * Kalimat penjelas tahap. Isinya dari STAGE_BACKFILL_NOTES (lib/order-status.ts),
 * kecuali dua tahap yang teksnya tergantung ada/tidaknya nomor resi.
 */
function stepDescription(status: string, hasTracking: boolean): string {
  const slug = normalizeStepName(status);
  if (slug === "kirim") {
    return hasTracking ? "Pesanan telah dikirim" : "Sedang diproses untuk pengiriman";
  }
  if (isOrderCompleted(slug)) return "Pesanan telah selesai";
  return STAGE_BACKFILL_NOTES[slug] || "Sedang diproses";
}

/** Judul tahap yang tampil besar di kartu progres. */
function stepHighlight(status: string, hasTracking: boolean): string {
  const slug = normalizeStepName(status);
  if (slug === "kirim") {
    return hasTracking ? "Pesanan Telah Dikirim" : "Sedang Diproses untuk Pengiriman";
  }
  if (isOrderCompleted(slug)) return "Pesanan Selesai";
  return ORDER_STATUS_LABELS[slug as OrderStatus] || "Sedang Diproses";
}

/**
 * Halaman status pesanan (client component).
 *
 * Sengaja TIDAK ada tombol "Hubungi CS"/WhatsApp di halaman ini: fungsinya
 * murni melihat progres pesanan, dan kanal komunikasi sudah lewat pesan
 * WhatsApp yang dikirim otomatis tiap tahap. Data awalnya datang dari server
 * (lihat lib/status-server.ts) supaya HTML pertama langsung berisi progres.
 */
export default function StatusClient({
  initial,
  initialLinkShared,
}: {
  /**
   * Data yang sudah dibaca server (lihat lib/status-server.ts). Kalau terisi,
   * HTML pertama sudah memuat progres pesanan — dulu blok ini kosong sampai
   * dua fetch berurutan selesai di browser.
   */
  initial?: {
    order: any;
    history: any[];
    steps: { name: string; position: number }[];
  } | null;
  /** Token ditolak karena dipakai dari banyak perangkat → modal verifikasi. */
  initialLinkShared?: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = (searchParams?.get("order") || "").toUpperCase();
  // Token dari link notifikasi WA → customer langsung lihat tanpa verifikasi HP.
  const urlToken = searchParams?.get("token") || "";

  const [phone, setPhone] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  // True kalau server menolak token karena link dibuka dari banyak perangkat
  // berbeda (indikasi link diteruskan ke orang lain / grup WA).
  const [linkShared, setLinkShared] = useState(!!initialLinkShared);

  const [order, setOrder] = useState<any>(initial?.order ?? null);
  const [history, setHistory] = useState<any[]>(initial?.history ?? []);
  const [loaded, setLoaded] = useState(!!initial?.order);
  const [steps, setSteps] = useState<{ name: string; position: number }[]>(
    initial?.steps ?? []
  );
  const pctRef = useRef<HTMLDivElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbScale, setLbScale] = useState(1);
  const [lbOffset, setLbOffset] = useState({ x: 0, y: 0 });
  const lbPinchRef = useRef<{ d: number; s: number } | null>(null);
  const lbDragRef = useRef<{ x: number; y: number } | null>(null);

  // Fetch order data on mount — always try fresh from DB via session token
  useEffect(() => {
    if (!orderId) return;
    const key = `taff_verified_${orderId}`;
    const tokenKey = `taff_token_${orderId}`;

    // Token dari link WhatsApp (HMAC, 30 hari) → simpan & langsung akses,
    // tanpa modal verifikasi HP. Kalau token invalid/expired, fetch di bawah
    // akan gagal dan fallback ke verifikasi HP seperti biasa.
    if (urlToken) sessionStorage.setItem(tokenKey, urlToken);

    // Sudah dirender server — jangan ditimpa fetch ulang. Token tetap disimpan
    // di atas supaya kunjungan berikutnya juga lolos tanpa verifikasi HP.
    if (initial?.order) return;

    const token = storedToken(tokenKey);

    if (!token) {
      // No token — require fresh verification
      setShowPhoneModal(true);
      return;
    }

    // Step 1: Fetch fresh order + history from DB
    fetch(`/api/track/session?order=${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        // Token link yang sudah dipakai dari banyak perangkat ditolak server
        // dengan `code: link_shared` → tampilkan alasan di modal verifikasi,
        // bukan sekadar "pesanan tidak ditemukan".
        if (r.status === 403) {
          const body = await r.json().catch(() => null);
          if (body?.code === "link_shared") setLinkShared(true);
          throw new Error("no session");
        }
        if (!r.ok) throw new Error("no session");
        return r.json();
      })
      .then((data) => {
        if (!data.order) {
          clearStoredToken(tokenKey);
          sessionStorage.removeItem(key);
          setShowPhoneModal(true);
          return;
        }

        // Step 2: Ensure history is complete (self-healing)
        return fetch("/api/track/ensure-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderNumber: orderId, token }),
        })
          .then((r) => r.json())
          .then((histData) => {
            const orderData = histData.order || data.order;
            const historyData = histData.history || data.history;
            sessionStorage.setItem(key, JSON.stringify({ order: orderData, history: historyData }));
            setOrder(orderData);
            setHistory(historyData);
            setLoaded(true);
          })
          .catch(() => {
            // ensure-history failed, use session data as fallback
            sessionStorage.setItem(key, JSON.stringify(data));
            setOrder(data.order);
            setHistory(data.history);
            setLoaded(true);
          });
      })
      .catch(() => {
        // Token expired/invalid/kedaluwarsa — buang lalu minta verifikasi ulang.
        clearStoredToken(tokenKey);
        sessionStorage.removeItem(key);
        setShowPhoneModal(true);
      });
  }, [orderId, urlToken, initial]);

  // Animate progress counter
  useEffect(() => {
    if (!order || !loaded) return;
    const stepIdx = stepIndexFromStatus(order.current_status, resolveStepOrder(steps));
    const hasTracking = !!(order.tracking_number && order.courier);
    const pct = getProgress(stepIdx, hasTracking);

    // Animate counter
    let p = 0;
    const iv = setInterval(() => {
      p += 2;
      if (p >= pct) {
        p = pct;
        clearInterval(iv);
      }
      if (pctRef.current) pctRef.current.textContent = String(p);
    }, 18);

    return () => clearInterval(iv);
  }, [order, loaded, steps]);

  // Fetch production steps from DB — dilewati kalau server sudah mengirimnya.
  useEffect(() => {
    if (initial?.steps?.length) return;
    fetch("/api/pesanan/steps")
      .then((r) => r.json())
      .then((d) => {
        if (d.steps && d.steps.length > 0) {
          setSteps(d.steps.sort((a: any, b: any) => a.position - b.position));
        }
      })
      .catch(() => {});
  }, [initial]);

  useEffect(() => {
    if (!lightboxUrl) return;
    setLbOpen(true);
    setLbScale(1);
    setLbOffset({ x: 0, y: 0 });
  }, [lightboxUrl]);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl]);

  useEffect(() => {
    if (!lightboxUrl) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [lightboxUrl]);

  // Reveal on scroll
  useEffect(() => {
    if (!loaded) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("trk-in");
        });
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll(".trk-reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [loaded]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setVerifyError("");
    setVerifying(true);

    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber: orderId, phone }),
      });

      if (!res.ok) {
        setVerifyError("Nomor HP tidak cocok dengan pesanan ini.");
        setVerifying(false);
        return;
      }

      const data = await res.json();
      if (!data.order) {
        setVerifyError("Nomor HP tidak cocok dengan pesanan ini.");
        setVerifying(false);
        return;
      }

      // Token hasil verifikasi berlaku 30 hari → "ingat perangkat ini".
      if (data.token) {
        try {
          localStorage.setItem(`taff_token_${orderId}`, data.token);
        } catch {
          /* localStorage diblokir — sessionStorage di bawah jadi cadangan */
        }
        sessionStorage.setItem(`taff_token_${orderId}`, data.token);
      }
      sessionStorage.setItem(`taff_verified_${orderId}`, JSON.stringify(data));
      setOrder(data.order);
      setHistory(data.history);
      setLoaded(true);
      setShowPhoneModal(false);
      setLinkShared(false);
    } catch {
      setVerifyError("Terjadi kesalahan. Coba lagi.");
      setVerifying(false);
    }
  }

  if (!orderId) {
    return (
      <div className="trk-bg min-h-screen">
        <div className="trk-grid min-h-screen">
          <div className="trk-glow min-h-screen flex items-center justify-center px-5">
            <div className="text-center">
              <p className="text-[#A3A3A3] text-[16px]">Nomor pesanan tidak ditemukan.</p>
              <button
                onClick={() => router.push("/track")}
                className="trk-btn-accent mt-6 px-6 py-3 text-[14px]"
              >
                Kembali ke Tracking
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="trk-bg min-h-screen">
        <div className="trk-grid min-h-screen">
          <div className="trk-glow min-h-screen">
            {/* Header */}
            <header className="sticky top-0 z-30 backdrop-blur-md bg-[rgba(10,10,11,.78)] border-b border-[#2E2E2E]">
              <div className="max-w-3xl mx-auto px-5 sm:px-8 py-4 flex items-center gap-3">
                <a
                  href="/track"
                  className="trk-btn-ghost w-9 h-9 grid place-items-center shrink-0"
                  aria-label="Kembali"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M11 18l-6-6 6-6" />
                  </svg>
                </a>
                <div className="leading-none">
                  <p className="trk-stencil text-[9px] text-[#A3A3A3]">TAFF Sportwear</p>
                  <p className="trk-display text-[15px] mt-1">Detail Progres Pesanan</p>
                </div>
              </div>
            </header>

            {/* Phone verification modal */}
            {showPhoneModal ? (
              <main className="max-w-3xl mx-auto px-5 sm:px-8 pt-10">
                <div className="trk-card p-5 sm:p-7 max-w-md mx-auto">
                  <p className="trk-display text-[20px] text-center mb-2">Verifikasi Pesanan</p>
                  <p className="text-[14px] text-[#A3A3A3] text-center mb-6">
                    Masukkan nomor HP untuk melihat{" "}
                    <span className="text-white font-semibold">{orderId}</span>
                  </p>

                  {linkShared && (
                    <p className="mb-5 rounded-xl border border-[rgba(35,187,183,.45)] bg-[rgba(35,187,183,.10)] px-4 py-3 text-[13px] leading-relaxed text-[#8FE3E0]">
                      Link ini sepertinya sudah dibagikan ke orang lain, jadi kami minta
                      verifikasi nomor HP dulu. Demi keamanan, mohon link dari WhatsApp
                      hanya dipakai sendiri ya.
                    </p>
                  )}

                  <form onSubmit={handleVerify}>
                    <label className="block">
                      <span className="trk-stencil text-[10px] text-[#A3A3A3]">Nomor HP</span>
                      <input
                        required
                        type="tel"
                        inputMode="numeric"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          setVerifyError("");
                        }}
                        placeholder="0812xxxxxxx"
                        autoFocus
                        className="trk-field w-full mt-2 px-4 py-3.5 text-[16px] tracking-wide"
                      />
                    </label>

                    {verifyError && (
                      <p className="mt-4 text-[13.5px] leading-relaxed rounded-xl border border-[rgba(255,59,47,.45)] bg-[rgba(255,59,47,.1)] text-[#ff8b83] px-4 py-3">
                        {verifyError}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={verifying}
                      className="trk-btn-accent w-full mt-6 py-4 text-[15px] flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {verifying ? "Memverifikasi…" : "Lihat Detail Pesanan"}
                    </button>
                  </form>
                </div>
              </main>
            ) : (
              /* Skeleton: sebelumnya blok ini benar-benar kosong, jadi halaman
                 terlihat hitam sampai data selesai dimuat. Sekarang bentuk
                 kartunya sudah tampil sejak frame pertama. */
              <main className="max-w-3xl mx-auto px-5 sm:px-8 pt-7 sm:pt-12" aria-busy="true">
                <div className="trk-card p-6 sm:p-8">
                  <div className="h-3 w-28 rounded-full bg-white/10 animate-pulse" />
                  <div className="mt-4 h-7 w-4/5 rounded-lg bg-white/10 animate-pulse" />
                  <div className="mt-3 h-7 w-1/2 rounded-lg bg-white/10 animate-pulse" />
                  <div className="mt-8 flex items-center justify-between gap-3">
                    <div className="h-8 flex-1 rounded-lg bg-white/[.06] animate-pulse" />
                    <div className="h-8 w-24 rounded-lg bg-white/[.06] animate-pulse" />
                  </div>
                  <div className="mt-7 h-2.5 w-full overflow-hidden rounded-full bg-white/[.07]">
                    <div className="h-full w-1/3 rounded-full bg-[#23BBB7]/40 animate-pulse" />
                  </div>
                </div>
                <div className="trk-card mt-4 p-5 sm:p-6">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5">
                      <div className="h-9 w-9 shrink-0 rounded-xl bg-white/[.07] animate-pulse" />
                      <div className="h-3 flex-1 rounded-full bg-white/[.06] animate-pulse" />
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-center text-[12.5px] text-[#8A8A85]">
                  Memuat status pesanan…
                </p>
              </main>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render order details
  // Nomor tahap mengikuti URUTAN di tabel `production_steps` (lihat
  // lib/step-order.ts), jadi penanda "sedang berjalan" selalu jatuh di baris
  // yang namanya sama dengan status pesanan — walau urutannya digeser admin.
  const stepOrder = resolveStepOrder(steps);
  const step = stepIndexFromStatus(order.current_status, stepOrder);
  const isOrderDone = isOrderCompleted(order.current_status);
  const totalSteps = TOTAL_STAGES;
  const hasTracking = !!(order.tracking_number && order.courier);
  const normalizedStatus = normalizeStepName(order.current_status);
  // Blok pengiriman cuma muncul kalau resinya ADA. Order yang langsung tuntas
  // ("selesai") tanpa resi cukup menampilkan status Selesai, tanpa tombol lacak.
  const isShipped =
    (normalizedStatus === "kirim" || normalizedStatus === "selesai") && hasTracking;
  const pct = getProgress(step, hasTracking);
  // Dua label kecil di bawah bar progres TIDAK ditulis mati ("Desain" / "Kirim").
  // Kiri = tahap pesanan ini sekarang, jadi kalau pesanannya sedang di Layout,
  // yang tampil ya "Layout". Kanan = tahap terakhir alur produksi.
  const stageNameOf = (n: number) => {
    const slug = stepOrder[Math.min(Math.max(n, 1), stepOrder.length) - 1];
    return slug ? labelFromSlug(slug) : "";
  };
  const progressFromLabel = isOrderDone ? stageNameOf(totalSteps) : stageNameOf(step);
  const progressToLabel = isOrderDone
    ? ORDER_STATUS_LABELS.selesai
    : stageNameOf(totalSteps);
  const lastUpdate = history.length > 0 ? history[history.length - 1] : null;
  // Keterangan "3 hari lagi" / "lewat 2 hari" untuk chip "Target selesai".
  const deadlineNote = formatDeadlineNoteID(order.deadline);

  // Product data (new structured format) with fallback to legacy fields
  const products: { name: string; sizes: { size: string; qty: number }[] }[] =
    Array.isArray(order.products) && order.products.length > 0
      ? order.products
      : [];
  const totalPcs = products.length > 0
    ? products.reduce((a, p) => a + p.sizes.reduce((x, s) => x + (s.qty || 0), 0), 0)
    : 0;

  // All unique sizes across products for the rekap table
  const allSizes = Array.from(new Set(products.flatMap((p) => p.sizes.map((s) => s.size))));

  return (
    <div className="trk-bg min-h-screen">
      <div className="trk-grid min-h-screen">
        <div className="trk-glow">
          {/* Header */}
          <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[rgba(10,10,11,.72)] backdrop-blur-xl">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-3.5">
              <div className="flex items-center gap-3">
<a
  href="/track"
  className="shrink-0"
  aria-label="Kembali ke tracking"
>
  {/* Mark saja (tanpa wordmark), karena teks TAFF Sportwear sudah ada di sampingnya */}
  <img
    src="/logo-taff-mark.png"
    alt=""
    aria-hidden="true"
    className="h-8 w-auto"
  />
</a>
                <div className="leading-tight">
                  <p className="trk-display text-[14.5px] font-semibold uppercase tracking-wide sm:text-[15px]">TAFF Sportwear</p>
                  <p className="text-[10.5px] text-[#8A8A85] sm:text-[11px]">Pabrik Jersey Custom Full Printing</p>
                </div>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6 sm:pb-20">

            {/* HERO / STATUS */}
            <section className="dpo-reveal pt-7 sm:pt-12">
              <p className="dpo-kicker">Detail Progres Pesanan</p>
              <h1 className="dpo-h1 mt-2.5">
                {normalizedStatus === "selesai" || isShipped ? (
                  <>Pesanan kamu sudah kami kirim</>
                ) : step <= 1 ? (
                  <>Pesanan kamu sedang kami kerjakan</>
                ) : (
                  <>Pesanan kamu sedang kami kerjakan</>
                )}
                <br className="hidden sm:block" />{" "}
                <span className="text-[#23BBB7]">sesuai jadwal</span>
              </h1>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(orderId);
                    const btn = document.getElementById("dpoCopyLabel");
                    if (btn) {
                      const o = btn.textContent;
                      btn.textContent = "Tersalin";
                      setTimeout(() => (btn.textContent = o), 1400);
                    }
                  }}
                  className="dpo-meta dpo-mono tracking-wider text-[#E4E4DF] hover:bg-white/[.08] transition"
                  title="Salin nomor pesanan"
                >
                  <span id="dpoCopyLabel">{orderId}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-[#8A8A85]" aria-hidden="true">
                    <rect x="9" y="9" width="11" height="11" rx="2"></rect>
                    <path d="M5 15V5a2 2 0 0 1 2-2h8"></path>
                  </svg>
                </button>
                <span className="dpo-meta dpo-meta-acc">
                  <span className="dpo-live"></span> {stepHighlight(order.current_status, hasTracking)}
                </span>
                {order.deadline && (
                  <span
                    className="dpo-meta"
                    title="Perkiraan tanggal pesanan selesai diproduksi (WIB)"
                  >
                    Target selesai
                    <span className="dpo-mono text-[#E4E4DF]">
                      {formatShortDateID(order.deadline)}
                    </span>
                    {deadlineNote && (
                      <span className="text-[#8A8A85]">· {deadlineNote}</span>
                    )}
                  </span>
                )}
              </div>

              {/* Overall progress card */}
              <div className="dpo-card mt-6 p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="dpo-kicker">Progres keseluruhan</p>
                    <p className="mt-1.5 font-bold leading-none text-[34px] dpo-h1 sm:text-[40px]">
                      <span ref={pctRef}>0</span>
                      <span className="ml-0.5 text-[20px] text-[#8A8A85]">%</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="dpo-h2 text-[15px]">Tahap {step} <span className="text-[#8A8A85]">/ {totalSteps}</span></p>
                    {lastUpdate && (
                      <p className="dpo-mono mt-1 text-[10.5px] leading-tight text-[#8A8A85]">
                        Update {formatShortDateTimeID(lastUpdate.created_at)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="dpo-segs mt-5" role="img" aria-label={`Tahap ${step} dari ${totalSteps} selesai`}>
                  {Array.from({ length: totalSteps }, (_, i) => (
                    <span key={i} className={i + 1 < step ? "on" : i + 1 === step ? "cur" : ""}></span>
                  ))}
                </div>
                <div className="dpo-mono mt-2.5 flex justify-between gap-3 text-[10px] uppercase tracking-wider text-[#8A8A85]">
                  <span className="truncate">{progressFromLabel}</span>
                  <span className="truncate text-right">{progressToLabel}</span>
                </div>
              </div>
            </section>

            {/* STEPPER */}
            <section className="dpo-reveal mt-9 sm:mt-12">
              <div className="flex items-end justify-between gap-3">
                <h2 className="dpo-h2">Tahap Produksi</h2>
                <span className="text-[12px] text-[#8A8A85]">{step} dari {totalSteps} tahap</span>
              </div>

              <ol className="dpo-steps mt-4">
                {(steps.length > 0
                  ? steps
                  : ORDER_STATUS_LIST.map((s, i) => ({ name: ORDER_STATUS_LABELS[s as OrderStatus] || s, position: i + 1 }))
                ).map((stepDef, idx) => {
                  const n = idx + 1;
                  // Gaya visual tahap TIDAK diubah (dot menyala & kartu hijau tetap
                  // seperti semula) — hanya teks chip di tahap terakhir yang beda
                  // kalau ordernya sudah tuntas.
                  const st = n < step ? "done" : n === step ? "now" : "todo";
                  const statusKey = steps.length > 0 ? normalizeStepName(stepDef.name) : ORDER_STATUS_LIST[idx];
                  // Satu tahap bisa punya beberapa baris riwayat (satu tiap kali
                  // tahap disimpan). Waktu transisi diambil dari baris PALING
                  // AWAL, sedangkan fotonya dari baris TERAKHIR yang punya foto —
                  // jadi foto yang baru diganti operator selalu yang tampil.
                  const histRows = history.filter(
                    (h: any) => normalizeStepName(h.status) === statusKey.toLowerCase()
                  );
                  const histEntry = histRows[0] ?? null;
                  const histPhoto = histRows.reduce(
                    (acc: string, h: any) => (h.photo_url ? h.photo_url : acc),
                    ""
                  );

                  return (
                    <li
                      key={stepDef.name}
                      className={`dpo-step ${st === "todo" ? "is-todo" : ""} ${st === "now" ? "is-now" : ""} ${n === totalSteps ? "is-last" : ""}`}
                    >
                      <span className={`dpo-dot ${st === "done" ? "done" : st === "now" ? "now" : ""}`}>
                        {st === "done" ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="17" height="17">
                            <path d="M20 6 9 17l-5-5"></path>
                          </svg>
                        ) : st === "now" ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="17" height="17">
                            <path d="M7 9V3h10v6"></path>
                            <rect x="3.5" y="9" width="17" height="8" rx="2"></rect>
                            <path d="M7.5 17h9v4h-9z"></path>
                          </svg>
                        ) : (
                          n
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="dpo-mono text-[11px] text-[#8A8A85]">{String(n).padStart(2, "0")}</span>
                          <h3 className="dpo-step-title">{stepDef.name}</h3>
                          {st === "done" && <span className="dpo-chip dpo-chip-done">Selesai</span>}
                          {st === "now" && (
                            <span className="dpo-chip dpo-chip-now">
                              {isOrderDone && n === totalSteps ? "Selesai" : "Sedang berjalan"}
                            </span>
                          )}
                          {st === "todo" && n === step + 1 && <span className="dpo-chip dpo-chip-next">Berikutnya</span>}
                        </div>
                        <p className="dpo-step-desc">{stepDescription(statusKey, hasTracking)}</p>
                        {histEntry ? (
                          <p className="dpo-mono dpo-step-time">{formatShortDateTimeID(histEntry.created_at)}</p>
                        ) : st === "todo" && order.deadline ? (
                          <p className="dpo-mono dpo-step-time">Mengikuti jadwal produksi</p>
                        ) : null}

                        {/* Foto bukti proses dari operator untuk tahap ini. */}
                        {histPhoto && (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(histPhoto)}
                            className="group relative mt-3 block overflow-hidden rounded-xl border border-white/10 bg-black"
                            title="Klik untuk memperbesar"
                            aria-label={`Perbesar foto tahap ${stepDef.name}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={optimizeImageUrl(histPhoto, 640)}
                              alt={`Foto tahap ${stepDef.name}`}
                              loading="lazy"
                              className="block w-full max-w-[280px] max-h-[320px] object-contain"
                            />
                            <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur border border-white/15 opacity-90 group-hover:bg-black/70 transition">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="11" cy="11" r="7" />
                                <path d="M20 20l-3.5-3.5M11 8v6M8 11h6" />
                              </svg>
                            </span>
                          </button>
                        )}

                        {/* Preview desain nempel di TAHAP DESAIN, bukan di tahap
                            yang sedang berjalan: foto desain itu hasil tahap 1,
                            jadi kalau blok ini ikut pindah tiap status di-update,
                            foto mockup muncul di tahap yang tidak ada hubungannya.
                            Lewati kalau tahap ini sudah punya foto prosesnya
                            sendiri — gambar yang sama tidak perlu tampil dua kali,
                            sebab foto dari form "Tambah Pesanan" juga tersimpan
                            sebagai foto tahap Desain. */}
                        {(statusKey === "desain" || n === 1) &&
                          !histPhoto &&
                          (order.design_photos?.length ?? 0) > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2.5">
                            {order.design_photos.map((url: string, di: number) => (
                              <button
                                key={di}
                                type="button"
                                onClick={() => setLightboxUrl(url)}
                                className="group relative block overflow-hidden rounded-xl border border-white/10 bg-black"
                                title="Klik untuk memperbesar"
                                aria-label={`Perbesar preview desain ${di + 1}`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={optimizeImageUrl(url, 640)}
                                  alt={`Preview desain pesanan ${di + 1}`}
                                  loading="lazy"
                                  className="block w-full max-w-[280px] max-h-[320px] object-contain"
                                />
                                <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur border border-white/15 opacity-90 group-hover:bg-black/70 transition">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <circle cx="11" cy="11" r="7" />
                                    <path d="M20 20l-3.5-3.5M11 8v6M8 11h6" />
                                  </svg>
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* RINCIAN PESANAN */}
            <section className="mt-10">
              <div className="dpo-card p-5 sm:p-6">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <h2 className="dpo-h2">Rincian Pesanan</h2>
                  {totalPcs > 0 && (
                    <span className="text-[12px] text-[#8A8A85]">
                      Total <span className="dpo-mono text-[#E4E4DF]">{fmtQty(totalPcs)}</span> pcs
                    </span>
                  )}
                </div>

                {products.length > 0 ? (
                  <>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {products.map((p, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.03] px-4 py-3.5">
                          <p className="text-[14.5px] font-medium">{p.name}</p>
                          <p className="dpo-mono text-[15px] flex-none text-[#23BBB7]">
                            {fmtQty(p.sizes.reduce((a, s) => a + (s.qty || 0), 0))}
                          </p>
                        </div>
                      ))}
                    </div>

                    {allSizes.length > 0 && (
                      <>
                        <p className="dpo-kicker mt-6">Rekap Ukuran per Item</p>
                        <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full text-[13px]">
                            <thead>
                              <tr className="bg-white/[.05] text-[11px] uppercase tracking-wider text-[#8A8A85]">
                                <th className="px-2 py-2.5 text-left font-medium w-[31%]">Ukuran</th>
                                {products.map((p) => (
                                  <th key={p.name} className="px-2 py-2.5 text-center font-medium">{p.name}</th>
                                ))}
                                <th className="px-2 py-2.5 text-right font-medium">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[.07]">
                              {allSizes.map((sz) => {
                                const rowTotal = products.reduce(
                                  (a, p) => a + (p.sizes.find((s) => s.size === sz)?.qty || 0), 0
                                );
                                return (
                                  <tr key={sz}>
                                    <td className="px-2 py-2.5"><span className="dpo-szlab">{sz}</span></td>
                                    {products.map((p) => {
                                      const qty = p.sizes.find((s) => s.size === sz)?.qty || 0;
                                      return (
                                        <td key={p.name} className={`dpo-mono px-2 py-2.5 text-center text-[14px] ${qty ? "" : "text-[#8A8A85]"}`}>
                                          {qty ? fmtQty(qty) : "–"}
                                        </td>
                                      );
                                    })}
                                    <td className="dpo-mono px-2 py-2.5 text-right text-[14px] font-semibold text-[#23BBB7]">{fmtQty(rowTotal)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-white/15 bg-white/[.04] font-semibold">
                                <td className="px-2 py-3 text-left text-[12px] uppercase tracking-wider text-[#8A8A85]">Total</td>
                                {products.map((p) => (
                                  <td key={p.name} className="dpo-mono px-2 py-3 text-center text-[14px]">
                                    {fmtQty(p.sizes.reduce((a, s) => a + (s.qty || 0), 0))}
                                  </td>
                                ))}
                                <td className="dpo-mono px-2 py-3 text-right text-[14px] text-[#23BBB7]">{fmtQty(totalPcs)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  /* Legacy orders: fallback ke format lama */
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3.5">
                      <p className="dpo-kicker">Produk</p>
                      <p className="mt-1 text-[14.5px] font-medium">{order.product_type || "-"}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3.5">
                      <p className="dpo-kicker">Jumlah</p>
                      <p className="mt-1 text-[14.5px] font-medium">{order.quantity || "-"}</p>
                    </div>
                    {order.sizes && (
                      <div className="col-span-2 rounded-xl border border-white/10 bg-white/[.03] px-4 py-3.5">
                        <p className="dpo-kicker">Ukuran</p>
                        <p className="mt-1 text-[14.5px] font-medium">{order.sizes}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* "Target" di header chip sering bikin bingung, jadi tanggalnya
                    diulang di sini lengkap dengan penjelasannya. */}
                {order.deadline && (
                  <div className="mt-4 rounded-xl border border-white/10 bg-white/[.03] px-4 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                      <p className="dpo-kicker">Target Selesai</p>
                      <p className="dpo-mono text-[14px] text-[#E4E4DF]">
                        {formatShortDateID(order.deadline)}
                        {deadlineNote && (
                          <span className="ml-2 text-[#8A8A85]">· {deadlineNote}</span>
                        )}
                      </p>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#8A8A85]">
                      Perkiraan tanggal pesanan kamu selesai diproduksi (WIB), bukan jadwal kirim ekspedisi.
                    </p>
                  </div>
                )}

                {order.design_notes && (
                  <details className="mt-5 group">
                    <summary className="cursor-pointer list-none flex items-center justify-between rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-[14px] hover:bg-white/[.06] transition">
                      <span>Catatan Desain</span>
                      <svg className="group-open:rotate-180 transition-transform" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </summary>
                    <p className="mt-3 px-1 text-[14px] text-[#A3A3A3] leading-relaxed">{order.design_notes}</p>
                  </details>
                )}
              </div>
            </section>

            {/* KIRIM / RESELLER INFO */}
            {isShipped && (
              <section className="dpo-card mt-8 p-5 sm:p-6">
                <h2 className="dpo-h2">Pesanan Dikirim</h2>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3.5">
                    <p className="dpo-kicker">Ekspedisi</p>
                    <p className="mt-1 text-[14.5px] font-medium">{order.courier}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3.5">
                    <p className="dpo-kicker">Nomor Resi</p>
                    <p className="mt-1 dpo-mono text-[14.5px] font-medium">{order.tracking_number}</p>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <a
                    href={
                      order.courier === "JNE"
                        ? "https://www.jne.co.id/tracking-package"
                        : order.courier === "J&T"
                          ? "https://www.jtexpress.co.id/track"
                          : order.courier === "SiCepat"
                            ? "https://www.sicepat.com/checkAWB"
                            : `https://www.google.com/search?q=track+${order.courier}+${order.tracking_number}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-full bg-[#23627C] px-6 py-3 text-center text-[14px] font-semibold text-white hover:bg-[#1B4F63] transition"
                  >
                    Lacak Pengiriman
                  </a>
                  <button
                    onClick={(e) => {
                      navigator.clipboard?.writeText(order.tracking_number);
                      const btn = e.currentTarget;
                      btn.textContent = "Tersalin ✓";
                      setTimeout(() => (btn.textContent = "Salin Resi"), 1600);
                    }}
                    className="rounded-full border border-white/[.12] bg-white/5 px-5 py-3 text-[14px] text-[#A3A3A3] hover:bg-white/10 hover:text-white transition"
                  >
                    Salin Resi
                  </button>
                </div>
              </section>
            )}

            <footer className="mt-10 text-center text-[12px] text-[#8A8A85]">
              <p>© 2026 TAFF Sportwear — Pabrik Jersey Custom Full Printing</p>
            </footer>
          </main>

          {lightboxUrl && (
            <div
              className={`fixed inset-0 z-[80] grid place-items-center p-4 sm:p-6 bg-black/90 backdrop-blur-[2px] transition duration-200 ${lbOpen ? "opacity-100" : "opacity-0"}`}
              onClick={() => {
                setLbOpen(false);
                setTimeout(() => setLightboxUrl(null), 200);
              }}
              onTouchMove={(e) => {
                if (lbPinchRef.current && e.touches.length === 2) {
                  e.preventDefault();
                  const d = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                  );
                  const ratio = d / lbPinchRef.current.d;
                  setLbScale(Math.min(4, Math.max(1, lbPinchRef.current.s * ratio)));
                }
              }}
              onTouchStart={(e) => {
                if (e.touches.length === 2) {
                  const d = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                  );
                  lbPinchRef.current = { d, s: lbScale };
                } else if (e.touches.length === 1 && lbScale > 1) {
                  lbDragRef.current = { x: e.touches[0].clientX - lbOffset.x, y: e.touches[0].clientY - lbOffset.y };
                }
              }}
              onTouchEnd={() => {
                lbPinchRef.current = null;
                lbDragRef.current = null;
                if (lbScale < 1) setLbScale(1);
              }}
              role="dialog"
              aria-modal="true"
              aria-label="Preview desain diperbesar"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLbOpen(false);
                  setTimeout(() => setLightboxUrl(null), 200);
                }}
                className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white border border-white/15 hover:bg-white/20 transition z-10"
                aria-label="Tutup"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={optimizeImageUrl(lightboxUrl, 1600)}
                alt="Preview desain diperbesar"
                onClick={(e) => e.stopPropagation()}
                onWheel={(e) => {
                  e.preventDefault();
                  const delta = e.deltaY > 0 ? -0.12 : 0.12;
                  setLbScale((s) => Math.min(4, Math.max(1, s + delta)));
                  if (lbScale <= 1) setLbOffset({ x: 0, y: 0 });
                }}
                onTouchMove={(e) => {
                  if (lbDragRef.current && e.touches.length === 1 && lbScale > 1) {
                    setLbOffset({ x: e.touches[0].clientX - lbDragRef.current.x, y: e.touches[0].clientY - lbDragRef.current.y });
                  }
                }}
                draggable={false}
                className={`max-w-[90vw] max-h-[90vh] object-contain select-none transition duration-200 ${lbOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}
                style={{ transform: `translate(${lbOffset.x}px, ${lbOffset.y}px) scale(${lbScale})`, touchAction: "none" }}
              />
              <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-[12px] text-white/60">Tap luar gambar / Esc untuk tutup • Pinch/scroll untuk zoom • Drag untuk geser</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
