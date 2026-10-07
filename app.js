/* Senkirss — 100% client-side. PDF.js untuk baca+render, pdf-lib untuk tulis. */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const $ = (id) => document.getElementById(id);
const els = {
  dropzone: $("dropzone"), fileInput: $("fileInput"),
  dzEmpty: $("dzEmpty"), dzFile: $("dzFile"),
  fileName: $("fileName"), fileMeta: $("fileMeta"),
  infoPages: $("infoPages"), infoText: $("infoText"), infoImg: $("infoImg"), infoDesc: $("infoDesc"),
  warnSig: $("warnSig"), warnLocked: $("warnLocked"),
  targetNum: $("targetNum"), targetRange: $("targetRange"), targetLabel: $("targetLabel"),
  btnCompress: $("btnCompress"), progBox: $("progBox"), progLabel: $("progLabel"),
  progPct: $("progPct"), progBar: $("progBar"), btnCancel: $("btnCancel"),
  prevOrig: $("prevOrig"), prevOut: $("prevOut"),
  qLabel: $("qLabel"), qBar: $("qBar"),
  resultBox: $("resultBox"), resSize: $("resSize"), resOrig: $("resOrig"),
  resBadge: $("resBadge"), resNote: $("resNote"), resLog: $("resLog"),
  btnSave: $("btnSave"), btnRetarget: $("btnRetarget"), btnOther: $("btnOther"), btnChange: $("btnChange"),
  dropOverlay: $("dropOverlay"), lightbox: $("lightbox"), lbImg: $("lbImg"),
  optBW: $("optBW"), optKeep: $("optKeep"),
};

let state = {
  fileBytes: null, fileName: "", fileSize: 0,
  pdfDoc: null, pageCount: 0, pageSizes: [],
  textChars: 0, imgCount: 0,
  targetBytes: 500 * 1024, unit: "KB", maxDpi: 150,
  cancelled: false, resultBytes: null, resultName: "",
  origPreviewURL: null,
};

const fmt = (b) => {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " KB";
  return (b / 1024 / 1024).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " MB";
};

/* ---------- target input ---------- */
function syncTarget(fromRange = false) {
  let v = parseFloat(els.targetNum.value);
  if (fromRange) v = parseFloat(els.targetRange.value) * (els.unit === "MB" ? 1 : 1);
  if (isNaN(v) || v <= 0) v = 500;
  // range slider selalu dalam KB-equivalent log-ish: 50..10000
  if (!fromRange) els.targetRange.value = Math.min(10000, Math.max(50, els.unit === "MB" ? v * 1024 : v));
  else els.targetNum.value = els.targetRange.value;
  const num = parseFloat(els.targetNum.value);
  els.targetBytes = Math.round(els.unit === "MB" ? num * 1024 * 1024 : num * 1024);
  els.targetLabel.textContent = els.unit === "MB" ? num + " MB" : num + " KB";
}
els.targetNum.addEventListener("input", () => syncTarget(false));
els.targetRange.addEventListener("input", () => syncTarget(true));
document.querySelectorAll(".unitBtn").forEach((b) =>
  b.addEventListener("click", () => {
    els.unit = b.dataset.unit; state.unit = b.dataset.unit;
    document.querySelectorAll(".unitBtn").forEach((x) => {
      const on = x === b;
      x.className = "unitBtn px-4 font-bold " + (on ? "bg-[#287A74] text-white" : "text-stone-500");
    });
    syncTarget(false);
  })
);
document.querySelectorAll(".preset").forEach((b) =>
  b.addEventListener("click", () => {
    const [n, u] = b.dataset.preset.split("|");
    els.unit = u; state.unit = u;
    document.querySelectorAll(".unitBtn").forEach((x) => {
      const on = x.dataset.unit === u;
      x.className = "unitBtn px-4 font-bold " + (on ? "bg-[#287A74] text-white" : "text-stone-500");
    });
    els.targetNum.value = n; syncTarget(false);
    document.getElementById("top").scrollIntoView({ behavior: "smooth" });
  })
);
document.querySelectorAll(".dpiBtn").forEach((b) =>
  b.addEventListener("click", () => {
    state.maxDpi = parseInt(b.dataset.dpi, 10);
    document.querySelectorAll(".dpiBtn").forEach((x) => {
      x.className = "dpiBtn px-3 py-1.5 rounded-full border " + (x === b ? "bg-stone-900 text-white" : "");
    });
  })
);

/* ---------- file picking ---------- */
els.dropzone.addEventListener("click", (e) => {
  if (e.target.id === "btnChange") return;
  els.fileInput.click();
});
els.btnChange.addEventListener("click", (e) => { e.stopPropagation(); els.fileInput.click(); });
els.fileInput.addEventListener("change", () => {
  if (els.fileInput.files[0]) loadFile(els.fileInput.files[0]);
});
els.btnOther.addEventListener("click", () => els.fileInput.click());
["dragenter", "dragover"].forEach((ev) =>
  window.addEventListener(ev, (e) => { e.preventDefault(); els.dropOverlay.classList.remove("hidden"); els.dropOverlay.classList.add("flex"); })
);
["dragleave", "drop"].forEach((ev) =>
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && e.relatedTarget) return;
    els.dropOverlay.classList.add("hidden"); els.dropOverlay.classList.remove("flex");
  })
);
window.addEventListener("drop", (e) => {
  const f = [...(e.dataTransfer?.files || [])].find((x) => /pdf$/i.test(x.type) || /\.pdf$/i.test(x.name));
  if (f) loadFile(f);
});
window.addEventListener("paste", async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) for (const t of it.types) {
      if (t === "application/pdf") { loadFile(new File([await it.getType(t)], "tempel.pdf")); return; }
    }
  } catch { /* clipboard ditolak, abaikan */ }
});

async function loadFile(file) {
  resetResult();
  els.warnLocked.classList.add("hidden");
  const buf = new Uint8Array(await file.arrayBuffer());
  state.fileBytes = buf; state.fileName = file.name || "dokumen.pdf"; state.fileSize = buf.length;
  els.dzEmpty.classList.add("hidden"); els.dzFile.classList.remove("hidden");
  els.fileName.textContent = state.fileName;
  els.fileMeta.textContent = fmt(state.fileSize) + " · menganalisis…";
  // tanda tangan digital?
  const head = new TextDecoder("latin1").decode(buf.slice(0, Math.min(buf.length, 4000000)).slice(0, 200000));
  const signed = /\/ByteRange/i.test(head) || /\/Type\s*\/Sig/i.test(new TextDecoder("latin1").decode(buf));
  els.warnSig.classList.toggle("hidden", !signed);
  try {
    const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    state.pdfDoc = doc; state.pageCount = doc.numPages;
    let chars = 0, imgs = 0;
    state.pageSizes = [];
    for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      if (p === 1) state.pageSizes._first = { w: vp.width, h: vp.height };
      state.pageSizes[p] = { w: vp.width, h: vp.height };
      try {
        const t = await page.getTextContent();
        chars += t.items.map((i) => i.str).join("").length;
        const ops = await page.getOperatorList();
        // 85 = PaintImageXObject (tidak stabil antar versi → hitung fn 85/86/87)
        imgs += ops.fnArray.filter((f) => f === 85 || f === 86 || f === 87).length;
      } catch { }
      page.cleanup();
    }
    state.textChars = chars; state.imgCount = imgs;
    els.infoPages.textContent = doc.numPages + " hlm";
    els.infoText.textContent = chars > 500 ? "banyak" : chars > 0 ? "ada" : "minim";
    els.infoImg.textContent = imgs > 0 ? imgs + " objek" : "minim";
    els.infoDesc.textContent = imgs === 0 && chars > 0
      ? "kebanyakan teks & font — susah dikecilkan tanpa jadi gambar."
      : imgs > 0 ? "ada gambar/scan yang bisa dikompres ulang." : "campuran teks & gambar.";
    els.fileMeta.textContent = fmt(state.fileSize) + " · " + doc.numPages + " halaman";
    await renderPreview(els.prevOrig, buf, 1);
    els.btnCompress.disabled = false;
    els.btnCompress.textContent = "Kompres ke " + els.targetLabel.textContent;
  } catch (err) {
    console.error(err);
    if (/password|encrypt/i.test(String(err?.message || err))) els.warnLocked.classList.remove("hidden");
    els.fileMeta.textContent = fmt(state.fileSize) + " · gagal dibaca (" + (err?.message || "rusak?") + ")";
  }
}

async function renderPreview(container, bytes, scale = 1.2) {
  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale });
  canvas.width = vp.width; canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  page.cleanup(); await doc.destroy();
  container.querySelector("canvas").style.width = "100%";
  return canvas;
}

/* ---------- kompres ---------- */
els.btnCompress.addEventListener("click", compress);
els.btnCancel.addEventListener("click", () => { state.cancelled = true; });
els.btnRetarget.addEventListener("click", () => { els.targetNum.focus(); els.targetNum.select(); window.scrollTo({ top: 0, behavior: "smooth" }); });

function setProg(pct, label) {
  els.progBar.style.width = pct + "%"; els.progPct.textContent = Math.round(pct) + "%";
  if (label) els.progLabel.textContent = label;
}

async function compress() {
  if (!state.fileBytes) return;
  syncTarget(false);
  state.cancelled = false; resetResult();
  els.progBox.classList.remove("hidden");
  els.btnCompress.disabled = true;
  const log = [];
  const t0 = performance.now();
  const target = els.targetBytes;
  const keepText = els.optKeep.checked, bw = els.optBW.checked, maxDpi = state.maxDpi;
  const safe = Math.floor(target * 0.985); // ruang pengaman 1.5%
  log.push(`Target: ${fmt(target)} (batas aman ${fmt(safe)}), maks ${maxDpi} dpi, BW=${bw}, jagaTeks=${keepText}`);
  try {
    // LANGKAH 1: rapikan tanpa merusak (pdf-lib re-save)
    setProg(4, "Langkah 1/3 — merapikan struktur…");
    let tidy = state.fileBytes;
    try {
      const src = await PDFLib.PDFDocument.load(state.fileBytes, { ignoreEncryption: false });
      tidy = await src.save({ useObjectStreams: true, addDefaultPage: false });
      log.push(`Rapikan: ${fmt(state.fileSize)} → ${fmt(tidy.length)}`);
    } catch (e) { log.push("Rapikan gagal (mungkin terenkripsi): " + e.message); }
    if (tidy.length <= safe) return finish(tidy, log, t0, "Rapihan struktur saja sudah cukup — kualitas 100% asli.", 100);

    if (keepText) {
      log.push("Target tidak tercapai dengan cara menjaga teks. Mengembalikan hasil terkecil yang teksnya utuh.");
      return finish(tidy, log, t0,
        `Target ${fmt(target)} tidak muat tanpa mengubah halaman jadi gambar. Ini hasil terkecil yang teksnya tetap utuh (${fmt(tidy.length)}). Matikan “Wajib jaga teks” atau naikkan target.`,
        100, false);
    }

    // LANGKAH 2+3: rasterisasi adaptif — cari dpi & kualitas tertinggi yang muat
    const dpis = [maxDpi, 150, 120, 100, 80, 72].filter((d, i, a) => d <= maxDpi && a.indexOf(d) === i).sort((a, b) => b - a);
    let best = null;
    outer:
    for (const dpi of dpis) {
      // estimasi cepat via halaman 1
      for (const q of [0.85, 0.7, 0.55, 0.4, 0.28]) {
        if (state.cancelled) throw new Error("dibatalkan");
        setProg(10 + Math.random() * 10, `Mencoba ${dpi} dpi · kualitas ${Math.round(q * 100)}…`);
        const est = await renderPageJpeg(1, dpi, q, bw);
        const guess = Math.round((est.length * state.pageCount * 1.02) + 2048);
        log.push(`uji ${dpi}dpi q=${q}: hlm1=${fmt(est.length)} → estimasi ${fmt(guess)}`);
        if (guess <= safe) {
          // render penuh + sesuaikan kualitas naik (binary search kasar)
          let lo = q, hi = Math.min(0.92, q + 0.25), full = null, fullQ = q;
          for (let it = 0; it < 4; it++) {
            const mid = (lo + hi) / 2;
            full = await rasterAll(dpi, mid, bw, (p, n) => setProg(15 + (75 * ((dpis.indexOf(dpi)) / dpis.length)) + (60 / n) * p / dpis.length, `Halaman ${p}/${n} · ${dpi} dpi…`));
            log.push(`penuh ${dpi}dpi q=${mid.toFixed(2)} → ${fmt(full.length)}`);
            if (full.length <= safe) { lo = mid; fullQ = mid; best = { bytes: full, dpi, q: mid }; hi = Math.min(0.92, mid + 0.12); if (hi - lo < 0.04) break; }
            else { hi = mid; if (hi - lo < 0.04) break; }
            if (state.cancelled) throw new Error("dibatalkan");
          }
          if (!best) { // fallback: pakai hasil terakhir yg muat
            full = await rasterAll(dpi, q, bw, null); best = { bytes: full, dpi, q };
          }
          break outer;
        }
      }
    }
    if (!best) {
      // mentok: hasil terkecil 72dpi q rendah
      setProg(90, "Target sangat kecil — memakai pengaturan minimum…");
      const full = await rasterAll(72, 0.25, bw, null);
      log.push(`minimum 72dpi → ${fmt(full.length)}`);
      return finish(full, log, t0,
        `Bahkan pengaturan minimum (${fmt(full.length)}) belum muat ke ${fmt(target)}. Coba nyalakan Hitam-putih, hapus halaman, atau naikkan target. Patokan: 1 hlm A4 scan ≈ 30–60 KB.`,
        25, false);
    }
    log.push(`dipilih ${best.dpi} dpi, kualitas ${Math.round(best.q * 100)}`);
    return finish(best.bytes, log, t0, `Gambar dikompres ulang pada ${best.dpi} dpi. Teks hasil scan ikut jadi gambar; bookmark & link asli tidak dipertahankan pada mode ini.`, qualityScore(best));
  } catch (e) {
    els.progBox.classList.add("hidden"); els.btnCompress.disabled = false;
    els.btnCompress.textContent = "Kompres ke " + els.targetLabel.textContent;
    if (String(e.message).includes("dibatalkan")) { setProg(0); els.progLabel.textContent = "Dibatalkan."; }
    else alert("Gagal mengompres: " + e.message);
  }
}

function qualityScore(best) {
  const dpiScore = Math.min(1, best.dpi / 200);
  return Math.round(35 + dpiScore * 40 + best.q * 25);
}

async function renderPageJpeg(pageNum, dpi, quality, bw) {
  const page = await state.pdfDoc.getPage(pageNum);
  const scale = dpi / 72;
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const ctx = c.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  const out = bw ? grayCanvas(c) : c;
  const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", quality));
  return new Uint8Array(await blob.arrayBuffer());
}

function grayCanvas(src) {
  const c = document.createElement("canvas"); c.width = src.width; c.height = src.height;
  const ctx = c.getContext("2d"); ctx.filter = "grayscale(1)"; ctx.drawImage(src, 0, 0);
  return c;
}

async function rasterAll(dpi, quality, bw, onPage) {
  const n = state.pageCount;
  const out = await PDFLib.PDFDocument.create();
  for (let p = 1; p <= n; p++) {
    if (state.cancelled) throw new Error("dibatalkan");
    const page = await state.pdfDoc.getPage(p);
    const vp0 = page.getViewport({ scale: 1 });
    const scale = dpi / 72;
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    const src = bw ? grayCanvas(c) : c;
    const blob = await new Promise((r) => src.toBlob(r, "image/jpeg", quality));
    const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const pg = out.addPage([vp0.width, vp0.height]);
    pg.drawImage(jpg, { x: 0, y: 0, width: vp0.width, height: vp0.height });
    onPage && onPage(p, n);
    // bebaskan memori canvas besar
    c.width = 1; c.height = 1;
  }
  return await out.save({ useObjectStreams: true });
}

async function finish(bytes, log, t0, note, q, ok = true) {
  state.resultBytes = bytes;
  const dt = ((performance.now() - t0) / 1000).toFixed(1);
  log.push(`selesai dalam ${dt}s → ${fmt(bytes.length)}`);
  els.progBox.classList.add("hidden");
  els.btnCompress.disabled = false;
  els.btnCompress.textContent = "Kompres ke " + els.targetLabel.textContent;
  els.resultBox.classList.remove("hidden");
  els.resSize.textContent = fmt(bytes.length);
  els.resOrig.textContent = fmt(state.fileSize);
  els.resNote.textContent = note;
  els.resLog.textContent = log.join("\n");
  els.qLabel.textContent = q + "%";
  els.qBar.style.width = q + "%";
  const meet = bytes.length <= els.targetBytes;
  els.resBadge.textContent = meet ? "✓ di bawah target" : "⚠ di atas target — lihat catatan";
  els.resBadge.className = "text-xs font-bold px-2 py-1 rounded-full " + (meet ? "bg-[#287A74] text-white" : "bg-amber-500 text-white");
  state.resultName = state.fileName.replace(/\.pdf$/i, "") + "-senkirss-" + els.targetLabel.textContent.replace(/\s/g, "") + ".pdf";
  try { await renderPreview(els.prevOut, bytes, 1.2); } catch { els.prevOut.innerHTML = "<span class='text-sm p-4'>Pratinjau gagal, tapi file tetap bisa disimpan.</span>"; }
  els.resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function resetResult() {
  state.resultBytes = null;
  els.resultBox.classList.add("hidden"); els.progBox.classList.add("hidden");
  els.prevOut.innerHTML = "<span class='text-stone-400 text-sm p-6 text-center'>—</span>";
  els.qLabel.textContent = "—"; els.qBar.style.width = "0%";
}

els.btnSave.addEventListener("click", () => {
  if (!state.resultBytes) return;
  const blob = new Blob([state.resultBytes], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = state.resultName;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

/* ---------- lightbox ---------- */
[els.prevOrig, els.prevOut].forEach((box) =>
  box.addEventListener("click", () => {
    const cv = box.querySelector("canvas");
    if (!cv) return;
    els.lbImg.src = cv.toDataURL("image/png");
    els.lightbox.classList.remove("hidden"); els.lightbox.classList.add("flex");
  })
);
els.lightbox.addEventListener("click", () => { els.lightbox.classList.add("hidden"); els.lightbox.classList.remove("flex"); });

/* ---------- PWA ---------- */
let deferred;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; });
$("btnInstall").addEventListener("click", async () => {
  if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; }
  else alert("Buka situs ini di Chrome/Edge → menu ⋮ → “Install / Pasang aplikasi”. Setelah dibuka sekali, situs tetap jalan offline.");
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
syncTarget(false);
