import { notFound } from "next/navigation";
import { PdfViewer } from "@/components/PdfViewer";
import { isAllowedPdfSrc } from "@/lib/pdfViewerHref";

// アプリ内のPDF表示画面（ホーム画面に追加したアプリでも「← 戻る」で戻れるように）
export default async function PdfViewPage({ searchParams }: PageProps<"/pdf-view">) {
  const sp = await searchParams;
  const src = typeof sp.src === "string" ? sp.src : "";
  if (!isAllowedPdfSrc(src)) notFound();
  return <PdfViewer src={src} />;
}
