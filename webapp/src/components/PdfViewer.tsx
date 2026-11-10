"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Content-Dispositionからファイル名を取り出す（無ければ document.pdf）
function fileNameFrom(disposition: string | null) {
  if (!disposition) return "document.pdf";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) return decodeURIComponent(encoded[1]);
  const plain = disposition.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : "document.pdf";
}

// PDFを各ページの画像（canvas）にして縦に並べる。iPhoneはPDFをそのまま埋め込むと
// 1ページ目しか出ないことがあるため、pdf.jsで描く。
export function PdfViewer({ src, sample = false }: { src: string; sample?: boolean }) {
  const router = useRouter();
  const pagesRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin" });
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("pdf")) throw new Error("not_pdf");
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        setFile(new File([buffer], fileNameFrom(res.headers.get("content-disposition")), { type: "application/pdf" }));

        // 古めのiPhone・Androidのブラウザでも動くよう、互換版（legacy）を使う
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
        const container = pagesRef.current;
        if (!container || cancelled) return;
        container.innerHTML = "";
        const width = container.clientWidth;
        const ratio = window.devicePixelRatio || 1;
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.className = "mb-3 bg-white shadow-md";
          canvas.setAttribute("aria-label", `${n}ページ目`);
          container.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
          if (cancelled) return;
        }
        setStatus("ready");
      } catch (error) {
        console.error("[PdfViewer]", error);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/home");
  }

  // スマホは共有メニュー（保存・LINE・メール・印刷など）、使えなければダウンロード
  async function share() {
    if (!file) return;
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-200">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b-2 border-accent app-header-safe bg-primary px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top)*1.5)] text-primary-foreground">
        <button type="button" onClick={goBack} className="py-1 text-sm font-semibold">
          ← 戻る
        </button>
        {/* 見本（下書きのプレビュー）は保存・共有させない */}
        {sample ? (
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">見本</span>
        ) : (
          <button
            type="button"
            onClick={share}
            disabled={!file}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-primary disabled:opacity-50"
          >
            保存・共有
          </button>
        )}
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {status === "loading" ? <p className="py-10 text-center text-sm text-muted">PDFを読み込んでいます…</p> : null}
        {status === "error" ? (
          <p className="py-10 text-center text-sm text-red-700">PDFを表示できませんでした。「← 戻る」で前の画面に戻ってお試しください。</p>
        ) : null}
        <div ref={pagesRef} />
      </main>
    </div>
  );
}
