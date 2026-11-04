import Link from "next/link";

type Notice = { id: string; companyName: string; title: string; createdAt: string };

function formatDate(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// ホームの上の「お知らせ」。未読を新しい順に3件まで出し、「すべて見る」でお知らせの一覧へ。
// 未読が無いときは出さない。
export function StaffNoticesSection({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return null;
  const shown = notices.slice(0, 3);
  return (
    <div className="mb-4 flex flex-col gap-1.5 rounded-2xl border border-accent/30 bg-accent/10 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-primary">お知らせ（未読{notices.length}件）</p>
        <Link href="/staff/notices" className="text-xs font-semibold text-primary underline">
          すべて見る
        </Link>
      </div>
      <ul className="flex flex-col gap-1">
        {shown.map((n) => (
          <li key={n.id}>
            <Link href={`/staff/notices?open=${n.id}`} className="flex items-baseline gap-2 text-xs text-foreground/90">
              <span className="shrink-0 text-muted">{formatDate(n.createdAt)}</span>
              <span className="min-w-0 truncate font-semibold">{n.title}</span>
              <span className="ml-auto shrink-0 truncate text-[11px] text-muted">{n.companyName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
