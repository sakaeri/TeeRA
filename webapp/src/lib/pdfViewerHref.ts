// アプリ内のPDF表示画面のURL。表示できるのは自分のサイトの /api/ 以下のPDFだけ。
export function pdfViewerHref(src: string) {
  return `/pdf-view?src=${encodeURIComponent(src)}`;
}

export function isAllowedPdfSrc(src: string) {
  return src.startsWith("/api/") && !src.startsWith("//") && !src.includes("\\");
}
