import "server-only";
import { Resend } from "resend";

// RESEND_API_KEYが未設定の間（ローカル開発・このリポジトリのCI環境など）は
// 実際には送信せず、リンクをコンソールに出すだけにする。本番でパスワード
// リセット/メールアドレス変更確認メールを実際に届けるには、Resendの
// アカウントを作成してRESEND_API_KEYとEMAIL_FROM（独自ドメイン未検証なら
// ひとまずonboarding@resend.devで可）をVercelの環境変数に設定すること。
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || "TeeRA <onboarding@resend.dev>";

async function sendMail(to: string, subject: string, html: string) {
  if (!resend) {
    console.log(`[email:fallback] RESEND_API_KEY未設定のため送信をスキップしました。宛先=${to} 件名=${subject}\n${html}`);
    return;
  }
  const result = await resend.emails.send({ from: FROM, to, subject, html });
  if (result.error) {
    console.error(`[email:resend-error] 宛先=${to} 件名=${subject}`, result.error);
  } else {
    console.log(`[email:sent] id=${result.data?.id} 宛先=${to} 件名=${subject}`);
  }
}

// 全メール共通のカード型レイアウト。アプリ内の確認画面（例:
// /email-actions/approve-work-report）と印象を揃えるため、白背景の
// 角丸カード＋ラベル薄色/値濃色の情報行というトーンに統一する。
function emailLayout(title: string, bodyHtml: string) {
  return `<div style="background:#f5f6f3;padding:32px 16px;font-family:'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',sans-serif;color:#1f2a24;">
  <div style="max-width:480px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:16px;font-size:20px;font-weight:bold;color:#0f4d3a;">TeeRA</div>
    <div style="background:#ffffff;border-radius:16px;padding:28px 24px;">
      <h1 style="margin:0 0 16px;font-size:16px;font-weight:bold;color:#0f4d3a;">${title}</h1>
      ${bodyHtml}
    </div>
    <p style="text-align:center;color:#9aa39c;font-size:11px;margin:16px 0 0;">このメールはTeeRAから自動送信されています。</p>
  </div>
</div>`;
}

function infoRow(label: string, value: string) {
  return `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;"><span style="color:#8b968e;">${label}：</span>${value}</p>`;
}

function button(url: string, label: string) {
  return `<p style="margin:20px 0 0;"><a href="${url}" style="display:inline-block;padding:11px 24px;background:#0f4d3a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;">${label}</a></p>`;
}

function note(html: string) {
  return `<p style="margin:16px 0 0;font-size:12px;color:#8b968e;line-height:1.6;">${html}</p>`;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await sendMail(
    to,
    "【TeeRA】パスワード再設定のご案内",
    emailLayout(
      "パスワード再設定のご案内",
      `<p style="margin:0;font-size:14px;line-height:1.6;">パスワード再設定のリクエストを受け付けました。以下のボタンから新しいパスワードを設定してください（1時間有効）。</p>
       ${button(resetUrl, "パスワードを再設定する")}
       ${note("心当たりがない場合はこのメールを破棄してください。")}`,
    ),
  );
}

export async function sendEmailChangeConfirmation(to: string, confirmUrl: string) {
  await sendMail(
    to,
    "【TeeRA】メールアドレス変更の確認",
    emailLayout(
      "メールアドレス変更の確認",
      `<p style="margin:0;font-size:14px;line-height:1.6;">このメールアドレスへの変更が申請されました。以下のボタンを押すと変更が確定します（1時間有効）。</p>
       ${button(confirmUrl, "変更を確定する")}
       ${note("心当たりがない場合はこのメールを破棄してください。")}`,
    ),
  );
}

export async function sendWorkReportSubmittedEmail(
  to: string,
  params: {
    staffName: string;
    date: string;
    timeLabel: string;
    // 欠勤・勤務先からのキャンセルの場合のみセット。WORKEDの通常報告では
    // null — 時間・業務内容の代わりに結果をはっきり出す（そうしないと
    // 予定時刻や「未定」しか見えず、欠勤・キャンセルだと気づけない）。
    outcomeLabel: string | null;
    taskLabel: string;
    approveUrl: string;
    reviewUrl: string;
  },
) {
  const title = params.outcomeLabel ? `${params.outcomeLabel}の報告が届きました` : "業務報告が届きました";
  const details = params.outcomeLabel
    ? infoRow("結果", params.outcomeLabel)
    : `${infoRow("時間", params.timeLabel)}
       ${infoRow("業務内容", params.taskLabel)}`;
  const buttonLabel = params.outcomeLabel ? "確認する" : "承認する";
  await sendMail(
    to,
    `【TeeRA】${title}`,
    emailLayout(
      title,
      `${infoRow("申請者", `${params.staffName}さん`)}
       ${infoRow("日付", params.date)}
       ${details}
       ${button(params.approveUrl, buttonLabel)}
       ${note(`内容を修正して差し戻す場合は、アプリを開いて操作してください。<br><a href="${params.reviewUrl}" style="color:#0f4d3a;">${params.reviewUrl}</a>`)}`,
    ),
  );
}

export async function sendShiftRequestDigestEmail(to: string, count: number, reviewUrl: string) {
  await sendMail(
    to,
    "【TeeRA】未確定のシフト希望があります",
    emailLayout(
      "未確定のシフト希望があります",
      `<p style="margin:0;font-size:14px;line-height:1.6;">現在、確定待ちのシフト希望が<strong>${count}件</strong>あります。</p>
       ${button(reviewUrl, "確認する")}`,
    ),
  );
}

export async function sendPromoOrderEmail(
  to: string,
  params: { staffName: string; itemName: string; reviewUrl: string },
) {
  await sendMail(
    to,
    "【TeeRA】販促品の注文が届きました",
    emailLayout(
      "販促品の注文が届きました",
      `${infoRow("スタッフ", `${params.staffName}さん`)}
       ${infoRow("商品", params.itemName)}
       ${button(params.reviewUrl, "確認する")}`,
    ),
  );
}

export async function sendShiftReminderEmail(
  to: string,
  params: { companyName: string; date: string; timeLabel: string; appUrl: string; isAllDay?: boolean },
) {
  const intro = params.isAllDay
    ? `本日、${params.companyName}でのシフトがあります。`
    : `${params.companyName}でのシフトが1時間後に始まります。`;
  await sendMail(
    to,
    "【TeeRA】まもなくシフトの時間です",
    emailLayout(
      "まもなくシフトの時間です",
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;">${intro}</p>
       ${infoRow("日付", params.date)}
       ${infoRow("時間", params.timeLabel)}
       ${button(params.appUrl, "アプリを開く")}`,
    ),
  );
}

export async function sendUnsubmittedWorkReportReminderEmail(to: string, count: number, appUrl: string) {
  await sendMail(
    to,
    "【TeeRA】未提出の業務報告があります",
    emailLayout(
      "未提出の業務報告があります",
      `<p style="margin:0;font-size:14px;line-height:1.6;">提出がまだの業務報告が<strong>${count}件</strong>あります。お手すきの際にご提出ください。</p>
       ${button(appUrl, "アプリを開く")}`,
    ),
  );
}

export async function sendContractConsentReminderEmail(to: string, companyNames: string[], appUrl: string) {
  await sendMail(
    to,
    "【TeeRA】契約書の確認をお願いします",
    emailLayout(
      "契約書の確認をお願いします",
      `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;">以下の会社から届いている契約書が、まだ確認・同意待ちのままです。</p>
       <p style="margin:0;font-size:14px;font-weight:bold;">${companyNames.join("、")}</p>
       ${button(appUrl, "アプリを開く")}`,
    ),
  );
}
