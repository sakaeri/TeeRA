// アプリ内のPDF表示画面のURL。表示できるのは自分のサイトの /api/ 以下のPDFだけ。
// sample: 見本のPDF（下書きのプレビュー）。保存・共有のボタンは出さない
export function pdfViewerHref(src: string, options: { sample?: boolean } = {}) {
  return `/pdf-view?src=${encodeURIComponent(src)}${options.sample ? "&sample=1" : ""}`;
}

// 使い方マニュアルのPDF（public/howto/manual.pdf）も開ける
export function isAllowedPdfSrc(src: string) {
  if (src === "/howto/manual.pdf" || src === "/howto/staff-manual.pdf") return true;
  return src.startsWith("/api/") && !src.startsWith("//") && !src.includes("\\");
}
