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
            <h1 className="mb-4 text-center text-lg font-semibold">
              {info.outcomeLabel ? `${info.outcomeLabel}の確認` : "業務報告の承認"}
            </h1>
            <div className="mb-4 flex flex-col gap-1 text-sm">
              <p>
                <span className="text-muted">申請者：</span>
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
              {info.outcomeLabel ? (
                <p>
                  <span className="text-muted">結果：</span>
                  <span className="font-semibold text-rose-700">{info.outcomeLabel}</span>
                </p>
              ) : (
                <>
                  <p>
                    <span className="text-muted">時間：</span>
                    {info.timeLabel}
                  </p>
                  <p>
                    <span className="text-muted">業務内容：</span>
                    {info.taskLabel}
                  </p>
                </>
              )}
            </div>
            <p className="mb-4 text-center text-sm font-semibold text-primary">
              {info.outcomeLabel ? "この内容を確認しましたか？" : "この内容で承認を確定しますか？"}
            </p>
            <ApproveWorkReportButton token={token} label={info.outcomeLabel ? "確認する" : undefined} />
          </>
        )}
      </div>
    </main>
  );
}
