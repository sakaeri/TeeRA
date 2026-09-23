import { getApproveWorkReportTokenInfo } from "@/lib/domain/emailNotifications";
import { ApproveWorkReportButton } from "@/components/email-actions/ApproveWorkReportButton";

export default async function ApproveWorkReportPage({
  params,
}: PageProps<"/email-actions/approve-work-report/[token]">) {
  const { token } = await params;
  const info = await getApproveWorkReportTokenInfo(token);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">TeeRA</div>
      <div className="rounded-2xl border border-border bg-white/60 p-6">
        {!info ? (
          <p className="text-sm text-muted">リンクが無効です。</p>
        ) : info.expired ? (
          <p className="text-sm text-muted">このリンクの有効期限が切れています。アプリから承認してください。</p>
        ) : info.alreadyUsed ? (
          <p className="text-sm text-muted">この業務報告は既に処理済みです。</p>
        ) : (
          <>
            <h1 className="mb-4 text-center text-lg font-semibold">業務報告の承認</h1>
            <div className="mb-6 flex flex-col gap-1 text-sm">
              <p>
                <span className="text-muted">スタッフ：</span>
                {info.staffName}さん
              </p>
              <p>
                <span className="text-muted">会社：</span>
                {info.companyName}
              </p>
              <p>
                <span className="text-muted">日付：</span>
                {info.date}
              </p>
              <p>
                <span className="text-muted">時間：</span>
                {info.timeLabel}
              </p>
              <p>
                <span className="text-muted">業務内容：</span>
                {info.taskLabel}
              </p>
            </div>
            <ApproveWorkReportButton token={token} />
          </>
        )}
      </div>
    </main>
  );
}
