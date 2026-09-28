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

// 全メール共通のカード型レイアウト。アプリ本体のヘッダー（濃い緑＋金の
// 下線、CompanyShell/StaffShell参照）と同じ配色に揃える。
function emailLayout(title: string, bodyHtml: string) {
  return `<div style="background:#f5f6f3;padding:32px 16px;font-family:'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',sans-serif;color:#1c2b26;">
  <div style="max-width:480px;margin:0 auto;">
    <div style="background:#0b3d2e;border-bottom:3px solid #c9a24b;border-radius:16px 16px 0 0;padding:18px 24px;text-align:center;">
      <span style="font-size:20px;font-weight:bold;color:#f4ead0;letter-spacing:0.05em;">TeeRA</span>
    </div>
    <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px 24px;">
      <h1 style="margin:0 0 16px;font-size:16px;font-weight:bold;color:#0b3d2e;">${title}</h1>
      ${bodyHtml}
    </div>
    <p style="text-align:center;color:#9aa39c;font-size:11px;margin:16px 0 0;">このメールはTeeRAから自動送信されています。</p>
  </div>
</div>`;
}

// 宛先が特定の個人（スタッフ本人・会員登録メールアドレス）である場合のみ
// 使う — 会社の共有受信箱(notificationEmail)宛のメールには使わない
// （誰が開くか分からない共有アドレスに「○○様」と付けると不自然なため）。
function greeting(name: string) {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;">${name}様</p>`;
}

function infoRow(label: string, value: string) {
  return `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;"><span style="color:#8b968e;">${label}：</span>${value}</p>`;
}

function button(url: string, label: string) {
  return `<p style="margin:20px 0 0;"><a href="${url}" style="display:inline-block;padding:11px 24px;background:#0b3d2e;color:#f4ead0;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;">${label}</a></p>`;
}

function note(html: string) {
  return `<p style="margin:16px 0 0;font-size:12px;color:#8b968e;line-height:1.6;">${html}</p>`;
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string) {
  await sendMail(
    to,
    "【TeeRA】パスワード再設定のご案内",
    emailLayout(
      "パスワード再設定のご案内",
      `${greeting(name)}
       <p style="margin:0;font-size:14px;line-height:1.6;">パスワード再設定のリクエストを受け付けました。以下のボタンから新しいパスワードを設定してください（1時間有効）。</p>
       ${button(resetUrl, "パスワードを再設定する")}
       ${note("心当たりがない場合はこのメールを破棄してください。")}`,
    ),
  );
}

export async function sendEmailChangeConfirmation(to: string, name: string, confirmUrl: string) {
  await sendMail(
    to,
    "【TeeRA】メールアドレス変更の確認",
    emailLayout(
      "メールアドレス変更の確認",
      `${greeting(name)}
       <p style="margin:0;font-size:14px;line-height:1.6;">このメールアドレスへの変更が申請されました。以下のボタンを押すと変更が確定します（1時間有効）。</p>
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
       ${note(`内容を修正して差し戻す場合は、アプリを開いて操作してください。<br><a href="${params.reviewUrl}" style="color:#0b3d2e;">${params.reviewUrl}</a>`)}`,
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
  params: {
    staffName: string;
    companyName: string;
    date: string;
    timeLabel: string;
    taskLabel: string | null;
    appUrl: string;
    isAllDay?: boolean;
    // 公開募集経由のシフトのみ — 応募条件/服装/持ち物/集合場所などの
    // 構造化項目(extraItems)と自由記述の備考(note)。
    recruitmentExtraItems?: { label: string; value: string }[];
    recruitmentNote?: string | null;
  },
) {
  // 実際の送信タイミングはCronの実行間隔に左右され「ちょうど1時間前」とは
  // 限らない（emailNotifications.tsのrunShiftStartReminders参照）ため、
  // 具体的な時間を断定しない文言にしている。
  const intro = params.isAllDay
    ? `本日、${params.companyName}でのシフトがあります。`
    : `${params.companyName}でのシフトの時間が近づいています。`;
  const extraItemsHtml = (params.recruitmentExtraItems ?? []).map((i) => infoRow(i.label, i.value)).join("");
  const recruitmentDetailsHtml =
    extraItemsHtml || params.recruitmentNote
      ? `<p style="margin:16px 0 4px;font-size:12px;font-weight:bold;color:#8b968e;">募集時の詳細</p>
         ${extraItemsHtml}
         ${params.recruitmentNote ? `<p style="margin:8px 0 0;font-size:13px;line-height:1.6;">${params.recruitmentNote}</p>` : ""}`
      : "";
  await sendMail(
    to,
    "【TeeRA】まもなくシフトの時間です",
    emailLayout(
      "まもなくシフトの時間です",
      `${greeting(params.staffName)}
       <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">${intro}</p>
       ${infoRow("日付", params.date)}
       ${infoRow("時間", params.timeLabel)}
       ${infoRow("勤務先", params.companyName)}
       ${params.taskLabel ? infoRow("業務内容", params.taskLabel) : ""}
       ${recruitmentDetailsHtml}
       ${button(params.appUrl, "タイムカードを開く")}`,
    ),
  );
}

export async function sendUnsubmittedWorkReportReminderEmail(to: string, name: string, count: number, appUrl: string) {
  await sendMail(
    to,
    "【TeeRA】未提出の業務報告があります",
    emailLayout(
      "未提出の業務報告があります",
      `${greeting(name)}
       <p style="margin:0;font-size:14px;line-height:1.6;">提出がまだの業務報告が<strong>${count}件</strong>あります。お手すきの際にご提出ください。</p>
       ${button(appUrl, "アプリを開く")}`,
    ),
  );
}

export async function sendContractConsentReminderEmail(to: string, name: string, companyNames: string[], appUrl: string) {
  await sendMail(
    to,
    "【TeeRA】契約書の確認をお願いします",
    emailLayout(
      "契約書の確認をお願いします",
      `${greeting(name)}
       <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">以下の会社から届いている契約書が、まだ確認・同意待ちのままです。</p>
       <p style="margin:0;font-size:14px;font-weight:bold;">${companyNames.join("、")}</p>
       ${button(appUrl, "アプリを開く")}`,
    ),
  );
}
