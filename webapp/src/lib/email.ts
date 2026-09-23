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
  await resend.emails.send({ from: FROM, to, subject, html });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await sendMail(
    to,
    "【TeeRA】パスワード再設定のご案内",
    `<p>パスワード再設定のリクエストを受け付けました。以下のリンクから新しいパスワードを設定してください（1時間有効）。</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>心当たりがない場合はこのメールを破棄してください。</p>`,
  );
}

export async function sendEmailChangeConfirmation(to: string, confirmUrl: string) {
  await sendMail(
    to,
    "【TeeRA】メールアドレス変更の確認",
    `<p>このメールアドレスへの変更が申請されました。以下のリンクをクリックすると変更が確定します（1時間有効）。</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p>心当たりがない場合はこのメールを破棄してください。</p>`,
  );
}

function button(url: string, label: string) {
  return `<p><a href="${url}" style="display:inline-block;padding:10px 20px;background:#0f4d3a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;">${label}</a></p>`;
}

export async function sendWorkReportSubmittedEmail(
  to: string,
  params: { staffName: string; date: string; timeLabel: string; taskLabel: string; approveUrl: string; reviewUrl: string },
) {
  await sendMail(
    to,
    "【TeeRA】業務報告が届きました",
    `<p>${params.staffName}さんから業務報告が届きました。</p>
     <p>日付：${params.date}　時間：${params.timeLabel}　業務内容：${params.taskLabel}</p>
     ${button(params.approveUrl, "承認する")}
     <p>内容を修正して差し戻す場合は、アプリを開いて操作してください。<br><a href="${params.reviewUrl}">${params.reviewUrl}</a></p>`,
  );
}

export async function sendShiftRequestDigestEmail(to: string, count: number, reviewUrl: string) {
  await sendMail(
    to,
    "【TeeRA】未確定のシフト希望があります",
    `<p>現在、確定待ちのシフト希望が${count}件あります。</p>${button(reviewUrl, "確認する")}`,
  );
}

export async function sendPromoOrderEmail(
  to: string,
  params: { staffName: string; itemName: string; reviewUrl: string },
) {
  await sendMail(
    to,
    "【TeeRA】販促品の注文が届きました",
    `<p>${params.staffName}さんが「${params.itemName}」を注文しました。</p>${button(params.reviewUrl, "確認する")}`,
  );
}

export async function sendShiftReminderEmail(
  to: string,
  params: { companyName: string; date: string; timeLabel: string; appUrl: string },
) {
  await sendMail(
    to,
    "【TeeRA】まもなくシフトの時間です",
    `<p>${params.companyName}でのシフトが1時間後に始まります。</p>
     <p>日付：${params.date}　時間：${params.timeLabel}</p>
     ${button(params.appUrl, "アプリを開く")}`,
  );
}

export async function sendUnsubmittedWorkReportReminderEmail(to: string, count: number, appUrl: string) {
  await sendMail(
    to,
    "【TeeRA】未提出の業務報告があります",
    `<p>提出がまだの業務報告が${count}件あります。お手すきの際にご提出ください。</p>${button(appUrl, "アプリを開く")}`,
  );
}

export async function sendContractConsentReminderEmail(to: string, companyNames: string[], appUrl: string) {
  await sendMail(
    to,
    "【TeeRA】契約書の確認をお願いします",
    `<p>以下の会社から届いている契約書が、まだ確認・同意待ちのままです。</p>
     <p>${companyNames.join("、")}</p>
     ${button(appUrl, "アプリを開く")}`,
  );
}
