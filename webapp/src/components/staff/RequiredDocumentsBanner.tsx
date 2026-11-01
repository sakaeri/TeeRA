import Link from "next/link";
import { REQUIRED_DOCUMENT_LABEL, type RequiredDocument } from "@/lib/requiredDocuments";

// スタッフのホームに出す「身分証・振込先を登録してください」。会社が必須にしていて
// まだ出していない書類がある間は出し続ける（契約書にも同意できないため）
export function RequiredDocumentsBanner({
  items,
}: {
  items: { companyId: string; companyName: string; missing: RequiredDocument[] }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mx-2 mb-3 flex flex-col gap-2 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-300 sm:mx-0">
      {items.map((item) => (
        <div key={item.companyId} className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">{item.companyName}</span>：
            {item.missing.map((m) => REQUIRED_DOCUMENT_LABEL[m]).join("・")}を登録してください
          </p>
          <Link
            href={`/staff/contracts/${item.companyId}`}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white"
          >
            登録する
          </Link>
        </div>
      ))}
    </div>
  );
}
