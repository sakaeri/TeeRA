"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { pdfViewerHref } from "@/lib/pdfViewerHref";

// ホーム画面に追加したアプリ（全画面表示）かどうか
function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// PDFを開くリンク。パソコンでは今まで通り新しいタブで開く。ホーム画面に追加した
// アプリやスマホでは、タブが無く戻れなくなるので、アプリ内のPDF表示画面（「← 戻る」付き）で開く。
export function PdfLink({
  href,
  className,
  children,
  title,
  ariaLabel,
  sample = false,
}: {
  href: string;
  sample?: boolean;
  className?: string;
  children: ReactNode;
  title?: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={ariaLabel}
      className={className}
      onClick={(e) => {
        if (isStandaloneApp() || window.innerWidth < 640) {
          e.preventDefault();
          router.push(pdfViewerHref(href, { sample }));
        }
      }}
    >
      {children}
    </a>
  );
}
