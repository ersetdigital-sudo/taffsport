"use client";

import { useSyncExternalStore } from "react";
import {
  formatBytes,
  getUploadJob,
  subscribeUploadJob,
} from "@/lib/upload-progress";

/**
 * Kartu kemajuan upload foto, muncul di pojok saat operator mengunggah.
 *
 * Satu kartu untuk semua tempat upload (design, WO, foto tahap, jersey maupun
 * maklon) karena sumbernya satu: lib/upload-progress.ts, yang diisi
 * `uploadToCloudinary()`. Jadi tidak perlu tiap tombol upload punya
 * indikatornya sendiri-sendiri.
 *
 * Isinya sengaja menyebut UKURANNYA, bukan cuma berputar-putar: operator jadi
 * tahu foto yang dia pilih berapa MB, dan berapa yang benar-benar dikirim
 * setelah diperkecil — pertanyaan yang paling sering muncul saat upload
 * terasa lama.
 */
export default function UploadIndicator() {
  // Snapshot awal di server = null (tidak ada upload saat halaman dirender).
  const job = useSyncExternalStore(subscribeUploadJob, getUploadJob, () => null);
  if (!job) return null;

  const compressing = job.phase === "compress";
  const percent = compressing ? 0 : job.percent;
  const saved = job.originalBytes - job.uploadBytes;

  return (
    <div className="pas-upload-pop" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="pas-upload-spin" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white">
            {compressing
              ? "Menyiapkan foto…"
              : `Mengunggah ${formatBytes(job.uploadBytes)}`}
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-[#D3EDEF]">
            {job.name} · {formatBytes(job.originalBytes)}
            {!compressing && saved > 0 && ` → ${formatBytes(job.uploadBytes)}`}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/20">
            <i
              className={
                compressing
                  ? "pas-upload-indeterminate block h-full rounded-full bg-[#23BBB7]"
                  : "block h-full rounded-full bg-[#23BBB7] transition-[width] duration-200 ease-out"
              }
              style={compressing ? undefined : { width: `${percent}%` }}
            />
          </div>
        </div>
        <span className="pas-num shrink-0 pt-0.5 text-[12.5px] font-bold text-[#D3EDEF]">
          {compressing ? "…" : `${percent}%`}
        </span>
      </div>
    </div>
  );
}
