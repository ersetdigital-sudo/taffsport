#!/usr/bin/env node
/**
 * Audit kontras WCAG 2.1 (AA) untuk pasangan warna yang dipakai TAFF Sportwear.
 * Jalankan: node scripts/contrast-audit.mjs
 * Threshold: 4.5 untuk teks normal (ukuran kecil), 3.0 untuk teks besar / ikon.
 * Kebijakan: semua teks tombol putih di atas latar gelap (deep blue / steel),
 * semua aksen terang dipakai sebagai latar, bukan sebagai warna teks.
 */

const HEX = (h) => {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const lin = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

// [deskripsi, fg (#hex atau {c:[r,g,b], a}), bg (#hex), kecil? (true = butuh 4.5)]
const PAIRS = [
  // ── ADMIN (terang) ──
  ["body admin ink / kartu putih", "#0A0A0A", "#FFFFFF", true],
  ["ink-2 / kartu putih", "#3A3A36", "#FFFFFF", true],
  ["--pas-muted / kartu putih", "#646460", "#FFFFFF", true],
  ["--pas-muted / cream", "#646460", "#F0EADF", true],
  ["--pas-muted-2 / kartu putih", "#646460", "#FFFFFF", true],
  ["th tabel / header bg", "#6B6B66", "#FAF6EE", true],
  ["placeholder / field putih", "#6B6B66", "#FFFFFF", true],
  ["label abu TSX / putih", "#5C5C5C", "#FFFFFF", true],
  ["pill status default", "#5C5C5C", "#EDEDE8", true],
  ["stepbtn num idle", "#6B6B66", "#EDEDE8", true],
  ["stepbtn label idle", "#6B6B66", "#FFFFFF", true],
  // ── badge & chip status ──
  ["badge Baru", "#23627C", "#D3EDEF", true],
  ["badge Produksi", "#14615F", "#D6F1F0", true],
  ["badge Kirim", "#1B4F63", "#DDE9EE", true],
  ["badge Selesai", "#3E6B41", "#E7F3E7", true],
  ["delta up", "#23627C", "#D3EDEF", true],
  ["delta flat", "#5C5C5C", "#E7E5DC", true],
  ["delta ok", "#795D17", "#F6EFDD", true],
  ["delta good", "#3E6B41", "#E7F3E7", true],
  ["delta bad", "#C0392B", "#FCE9E4", true],
  ["banner peringatan deadline", "#7A5C17", "#F0EADF", true],
  ["alert warn kapasitas", "#7A5A1C", "#FBF3E4", true],
  ["error form", "#C0392B", "#FFFFFF", true],
  ["error login", "#A83224", "#FCE9E4", true],
  // ── TOMBOL (semua teks putih) ──
  ["tombol utama / deep blue", "#FFFFFF", "#23627C", true],
  ["tombol utama sisi gelap gradient", "#FFFFFF", "#1B4F63", true],
  ["tombol sekunder (ghost & chip idle)", "#FFFFFF", "#3B6B7E", true],
  ["tombol sekunder hover", "#FFFFFF", "#2E5968", true],
  ["chip filter aktif", "#FFFFFF", "#1B4F63", true],
  ["toast notifikasi", "#FFFFFF", "#23627C", true],
  ["stepbtn num aktif", "#FFFFFF", "#1B4F63", true],
  ["footer Simpan Perubahan", "#FFFFFF", "#23627C", true],
  ["footer Tandai Selesai (sekunder)", "#FFFFFF", "#3B6B7E", true],
  // ── SIDEBAR / DRAWER deep blue ──
  ["label section sidebar (0.82)", { c: [255, 255, 255], a: 0.82 }, "#23627C", true],
  ["navlink sidebar (0.85)", { c: [255, 255, 255], a: 0.85 }, "#23627C", true],
  ["brand-sub sidebar (0.85)", { c: [255, 255, 255], a: 0.85 }, "#23627C", true],
  ["nav item aktif putih / deep blue", "#FFFFFF", "#23627C", true],
  ["bottom-nav idle ikon (0.55)", { c: [255, 255, 255], a: 0.55 }, "#1B4F63", false],
  ["bottom-nav aktif ikon", "#23BBB7", "#1B4F63", false],
  // ── KPI HERO / LOGIN (gradient deep blue) ──
  ["KPI hero angka putih / sisi terang", "#FFFFFF", "#2A6E8A", true],
  ["KPI hero label / sisi terang", "#E9F3F6", "#2A6E8A", true],
  ["KPI hero delta chip", "#1B4F63", "#E3F4F5", true],
  // ── HALAMAN GELAP (customer) ──
  ["body gelap / #0A0A0A", "#A3A3A3", "#0A0A0A", true],
  ["kicker & label kecil / #0A0A0A", "#8A8A85", "#0A0A0A", true],
  ["trk placeholder / #050505", "#8A8A85", "#050505", true],
  ["label selesai / #0A0A0A", "#E4E4DF", "#0A0A0A", true],
  ["aksen turquoise / #0A0A0A", "#23BBB7", "#0A0A0A", true],
  ["CTA customer (putih / deep blue)", "#FFFFFF", "#23627C", true],
  ["CTA customer hover", "#FFFFFF", "#1B4F63", true],
  ["salin resi", "#A3A3A3", "#0A0A0A", true],
  ["badge NOW turquoise / kartu gelap", "#062B2A", "#23BBB7", true],
  ["teks turquoise / kartu gelap", "#23BBB7", "#141414", true],
  // ── LAINNYA ──
  ["WA floating (ikon)", "#062b13", "#25D366", false],
  ["ghost lama (dihapus, referensi)", "#4A4A46", "#E7E5DC", true],
];

let fail = 0;
for (const [label, fg, bg, small] of PAIRS) {
  const bgRGB = HEX(bg);
  const fgRGB = typeof fg === "string" ? HEX(fg) : over(fg.c, fg.a, bgRGB);
  const l1 = lum(fgRGB), l2 = lum(bgRGB);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const need = small ? 4.5 : 3.0;
  const ok = ratio >= need;
  if (!ok) fail++;
  const name = typeof fg === "string" ? fg : `rgba(...${fg.a})`;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${ratio.toFixed(2).padStart(5)} (butuh ${need})  ${label}  [${name} on ${bg}]`
  );
}
console.log(`\n${fail} pasangan gagal dari ${PAIRS.length}.`);
process.exit(fail ? 1 : 0);
