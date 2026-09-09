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
