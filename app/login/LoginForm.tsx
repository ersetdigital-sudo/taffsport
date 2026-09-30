"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
} from "lucide-react";
import type { Brand } from "@/lib/types";

/**
 * Layar login.
 *
 * Satu form, dua komposisi: panel brand bersudut di kiri untuk layar lebar dan
 * tumpukan brand di atas untuk ponsel. Yang berbeda cuma tempat identitas toko
 * diletakkan — field, aksi, dan pesan errornya sama, jadi tidak ada dua jalur
 * login yang bisa berbeda perilaku.
 */
export default function LoginForm({ brand }: { brand: Brand }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Tagline disimpan bertingkat: baris pertama jadi judul panel brand,
  // sisanya jadi kalimat pendukung.
  const [headline, ...restLines] = brand.tagline
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const subline = restLines.join(" ");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/pesanan/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      });

      if (!res.ok) {
        // Bedakan dua kegagalan yang berbeda penyebabnya: password salah
        // (bisa dicoba lagi) vs server belum dikonfigurasi (percuma diulang).
        const data = await res.json().catch(() => null);
        const message =
          data?.error === "Invalid password"
            ? "Password tidak cocok. Periksa penulisannya, lalu coba lagi."
            : data?.error ||
              "Server belum bisa memproses login. Hubungi admin.";
        setError(message);
        setLoading(false);
        return;
      }

      router.push("/pesanan/orders");
      router.refresh();
    } catch {
      setError("Tidak bisa menghubungi server. Periksa koneksi, lalu coba lagi.");
      setLoading(false);
    }
  }

  const form = (
    <form onSubmit={handleSubmit} noValidate className="w-full">
      <h1 className="pas-display text-[27px] leading-[1.15] sm:text-[30px]">
        Masuk ke panel pesanan
      </h1>
      <p className="mt-3 text-[13.5px] leading-[1.6] text-[var(--pas-ink-2)]">
        Satu password untuk dashboard Pesanan dan Maklon.
      </p>

      <label className="mt-8 block">
        <span className="pas-auth-label">Password</span>
        <span className="pas-auth-input mt-2 block">
          <span className="lead" aria-hidden="true">
            <Lock className="h-4 w-4" />
          </span>
          <input
            required
            autoFocus
            name="taff-pesanan-pass"
            type={reveal ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setError("");
            }}
            placeholder="••••••••"
            aria-invalid={error ? true : undefined}
            className="pas-field w-full px-4 py-3.5 text-[16px]"
          />
          <button
            type="button"
            onClick={() => setReveal((value) => !value)}
            aria-label={reveal ? "Sembunyikan password" : "Tampilkan password"}
            aria-pressed={reveal}
            className="peek"
          >
            {reveal ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </span>
      </label>

      {error && (
        <p role="alert" className="pas-auth-error mt-4">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="pas-btn-accent mt-5 flex w-full items-center justify-center gap-2 py-3.5 text-[15px] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {loading ? "Memverifikasi…" : "Masuk"}
      </button>

      <p className="pas-auth-hint mt-7">
        Pelanggan mau melacak pesanannya?{" "}
        <Link href="/track" className="pas-auth-link">
          Buka halaman lacak
          <ArrowRight className="ml-1 inline h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </p>
    </form>
  );

  return (
    <>
      {/* ── Layar lebar: panel brand bersudut + panel form ── */}
      <main className="pas-auth-stage">
        <div className="pas-auth-frame">
          <section className="pas-auth-hero">
            <div className="flex items-center gap-3">
              <span className="pas-auth-plate h-11 w-11">
                <img src={brand.logoPath} alt="" />
              </span>
              <span className="pas-stencil text-[12px] text-white">
                {brand.name}
              </span>
            </div>

            <div className="flex flex-1 flex-col justify-center py-10">
              {headline && <p className="pas-auth-quote">{headline}</p>}
              {subline && (
                <p className="mt-5 max-w-[30ch] text-[13.5px] leading-[1.6] text-[#C4C4C4]">
                  {subline}
                </p>
              )}
            </div>

            <p className="max-w-[32ch] text-[12.5px] leading-[1.6] text-[#C4C4C4]">
              Belum punya akses? Hubungi admin via{" "}
              <a
                href={`https://wa.me/${brand.whatsappNumber}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-white underline decoration-white/40 underline-offset-4 transition-colors hover:decoration-white"
              >
                WhatsApp
              </a>
              .
            </p>
          </section>

          <section className="pas-auth-form">
            <div className="pas-auth-form-inner pas-auth-enter">{form}</div>
          </section>
        </div>
      </main>

      {/* ── Ponsel: masthead, panel brand, lalu form ── */}
      <main className="pas-auth-mobile">
        <div className="flex items-center gap-3">
          <span className="pas-auth-plate h-9 w-9">
            <img src={brand.logoPath} alt="" />
          </span>
          <span className="pas-stencil text-[11px] text-[var(--pas-ink-1)]">
            {brand.name}
          </span>
        </div>

        <div className="pas-auth-slate mt-4">
          <span className="pas-auth-plate h-[72px] w-[72px]">
            <img src={brand.logoPath} alt="" />
          </span>
          {subline && (
            <p className="max-w-[20ch] text-[13px] leading-[1.6] text-[#C4C4C4]">
              {subline}
            </p>
          )}
        </div>

        <div className="pas-auth-enter mt-8">{form}</div>
      </main>
    </>
  );
}
