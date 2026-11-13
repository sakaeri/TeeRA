"use client";

import { CLOSING_DAY_OPTIONS, closingDayLabel } from "@/lib/closingPeriod";
import { useEffect, useState, useTransition } from "react";
import { InfoPopupButton } from "@/components/InfoPopupButton";
import { useRouter } from "next/navigation";
import { pdfViewerHref } from "@/lib/pdfViewerHref";
import {
  updateCompanyNameAction,
  updateCompanyInvoiceRegistrationNumberAction,
  updateCompanyAddressAction,
  updateCompanyPhoneNumberAction,
  updateCompanyNotificationEmailAction,
  updateCompanyWorkReportDigestHourAction,
  updateCompanyPayrollClosingDayAction,
  updateCompanySealAction,
  updateCompanySealOpacityAction,
  setMemberCanWorkShiftsAction,
  removeCompanyMemberRoleAction,
  inviteCompanyAdminAction,
  promoteStaffToCompanyAdminAction,
  createTeamAction,
  updateTeamNameAction,
  updateTeamNotificationEmailAction,
  setTeamMemberRoleAction,
  inviteTeamManagerAction,
  promoteExistingStaffToTeamRoleAction,
} from "@/app/company/actions";
import { ContractsView } from "@/components/company/ContractsView";
import { WorkReportsQueue } from "@/components/company/WorkReportsQueue";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyUrlField } from "@/components/CopyUrlField";

type Admin = {
  userId: string;
  name: string;
  email: string;
  role: "COMPANY_ADMIN" | "COMPANY_EDITOR";
  canWorkShifts: boolean;
};

type TeamMember = { userId: string; name: string; email: string; role: string };
type Team = { id: string; name: string; notificationEmail: string; members: TeamMember[] };
type StaffOption = { userId: string; name: string };

// 2チーム目以降の作成コスト。src/lib/domain/teams.tsのTEAM_UNLOCK_TEE_COSTと
// 同値（"server-only"ファイルのためクライアント側では値のみ複製）。
const TEAM_UNLOCK_TEE_COST = 10;

type ContractTemplate = {
  id: string;
  title: string;
  employmentType: string;
  workplaceType: string | null;
  workplaceNote: string | null;
  clientName: string | null;
  jobDescription: string;
  scheduleType: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  actualWorkMinutes: number | null;
  breakMinutes: number | null;
  hasOvertime: boolean;
  overtimeNote: string | null;
  requireIdDocument: boolean;
  requireBankInfo: boolean;
  fixedWeekdays: number[];
  shiftPatternNote: string | null;
  restNote: string | null;
  wageType: string;
  wageAmount: number;
  paymentClosingDay: string | null;
  paymentDay: string | null;
  paymentMethod: string | null;
  contractPeriodType: string | null;
  contractStartDate: string;
  contractEndDate: string | null;
  extraItems: { label: string; value: string }[];
  status: string;
  contractedStaffNames: string[];
};
type ContractClientOption = { id: string; name: string };

type WorkReportRow = {
  id: string;
  staffName: string;
  outcome: string;
  date: string;
  computedHours: string;
  comment: string | null;
  taskName: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  breakMinutes: number;
  isUnscheduled: boolean;
};

const TABS = [
  { key: "basic", label: "基本情報" },
  { key: "contracts", label: "契約関連" },
  { key: "workreports", label: "業務報告" },
  { key: "howto", label: "使い方" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function SettingsView({
  initialTab,
  initialCreate,
  isCompanyAdmin,
  currentUserId,
  companyName,
  invoiceRegistrationNumber,
  address,
  phoneNumber,
  notificationEmail,
  workReportDigestHour,
  payrollClosingDay,
  sealImageDataUrl,
  sealOpacity,
  admins,
  teams,
  staff,
  teeBalance,
  contractTemplates,
  contractClients,
  workReports,
}: {
  initialTab: string;
  initialCreate?: "template" | "team";
  // falseならチームマネージャー（会社情報は名称・住所・電話のみ、自チームだけ）
  isCompanyAdmin: boolean;
  currentUserId: string;
  companyName: string;
  invoiceRegistrationNumber: string;
  address: string;
  phoneNumber: string;
  notificationEmail: string;
  workReportDigestHour: number;
  payrollClosingDay: number | null;
  sealImageDataUrl: string | null;
  sealOpacity: number;
  admins: Admin[];
  teams: Team[];
  staff: StaffOption[];
  teeBalance: number;
  contractTemplates: ContractTemplate[];
  contractClients: ContractClientOption[];
  workReports: WorkReportRow[];
}) {
  const router = useRouter();
  // 契約書テンプレートは本部が管理するため、チームマネージャーには出さない
  const tabs = isCompanyAdmin ? TABS : TABS.filter((t) => t.key !== "contracts");
  const tab: TabKey = tabs.some((t) => t.key === initialTab) ? (initialTab as TabKey) : "basic";
  // 「よく使う操作」から来た時の作成の指定（?create=）は一度開いたら消す（再読み込みで何度も開かないように）
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("create")) {
      url.searchParams.delete("create");
      window.history.replaceState(null, "", url);
    }
  }, []);

  return (
    <div>
      <div className="print-hide mb-8 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => router.push(`?tab=${t.key}`)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === t.key ? "border-accent text-primary" : "border-transparent text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "basic" && !isCompanyAdmin ? (
        <div className="flex flex-col gap-10">
          <CompanyInfoReadOnly companyName={companyName} address={address} phoneNumber={phoneNumber} />
          <TeamsSection
            teams={teams}
            staff={staff}
            teeBalance={teeBalance}
            managerMode
            currentUserId={currentUserId}
            openCreate={initialCreate === "team"}
          />
        </div>
      ) : null}

      {tab === "basic" && isCompanyAdmin ? (
        <div className="flex flex-col gap-10">
          <CompanyInfoSection
            companyName={companyName}
            invoiceRegistrationNumber={invoiceRegistrationNumber}
            address={address}
            phoneNumber={phoneNumber}
            notificationEmail={notificationEmail}
            workReportDigestHour={workReportDigestHour}
            payrollClosingDay={payrollClosingDay}
          />
          <SealSection companyName={companyName} sealImageDataUrl={sealImageDataUrl} sealOpacity={sealOpacity} />
          <div id="admins" className="scroll-mt-24">
            <AdminsSection admins={admins} staff={staff} />
          </div>
          <TeamsSection
            teams={teams}
            staff={staff}
            teeBalance={teeBalance}
            currentUserId={currentUserId}
            openCreate={initialCreate === "team"}
          />
        </div>
      ) : null}

      {tab === "contracts" ? (
        <ContractsView
          templates={contractTemplates}
          clients={contractClients}
          companyName={companyName}
          openCreate={initialCreate === "template"}
        />
      ) : null}

      {tab === "workreports" ? <WorkReportsQueue reports={workReports} /> : null}

      {tab === "howto" ? <HowToSection /> : null}
    </div>
  );
}

function StepGuide({
  image,
  alt,
  steps,
  note,
}: {
  image: string;
  alt: string;
  steps: React.ReactNode[];
  note?: React.ReactNode;
}) {
  return (
    // 印刷時は端末の画面幅に関係なく「左に画像・右に文字」で並べ、画像は
    // 縦横比をそろえて上端だけ見せる（縦長の画像で1項目が伸び、1ページ
    // 3項目に収まらなくなるのを防ぐ）。文字の方が長い項目で画像の枠まで
    // 縦に引き伸ばされると左右が切れるため、self-startで伸ばさない。
    <div className="flex flex-col gap-4 sm:flex-row print:flex-row print:gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt={alt}
        className="w-full rounded-xl border border-border sm:w-1/2 print:aspect-[64/45] print:w-[44%] print:shrink-0 print:self-start print:rounded-md print:object-cover print:object-top"
      />
      <div className="flex-1">
        <ol className="list-decimal space-y-2 pl-5 text-sm print:space-y-1 print:pl-4 print:text-[12px] print:leading-snug">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {note ? <p className="mt-3 text-xs text-muted print:mt-1.5 print:text-[11px] print:leading-snug">{note}</p> : null}
      </div>
    </div>
  );
}

const HOWTO_SECTIONS: { id: string; label: string }[] = [
  { id: "howto-dashboard", label: "①ダッシュボード" },
  { id: "howto-staff", label: "②スタッフ追加" },
  { id: "howto-contract", label: "③契約書を用意" },
  { id: "howto-team", label: "④チーム作成" },
  { id: "howto-client", label: "⑤依頼主を管理" },
  { id: "howto-account", label: "⑥通知・ログイン設定" },
  { id: "howto-shift", label: "⑦シフト作成" },
  { id: "howto-requests", label: "⑧シフト希望" },
  { id: "howto-recruit", label: "⑨募集を出す" },
  { id: "howto-announce", label: "⑩スタッフへのお知らせ" },
  { id: "howto-timecard", label: "⑪タイムカード" },
  { id: "howto-approve", label: "⑫業務報告承認" },
  { id: "howto-unscheduled", label: "⑬シフト外の勤務" },
  { id: "howto-paidleave", label: "⑭有給休暇" },
  { id: "howto-cancelrule", label: "⑮キャンセル規定" },
  { id: "howto-share", label: "⑯依頼主とシフト共有" },
  { id: "howto-clientcancel", label: "⑰依頼主の取り消し" },
  { id: "howto-payroll", label: "⑱給与明細" },
  { id: "howto-invoice", label: "⑲請求書" },
  { id: "howto-wallet", label: "⑳Tee・プラン" },
  { id: "howto-notifications", label: "㉑届く通知" },
];

// ㉑ 会社側に届く通知（emailNotifications.ts で実際に送っているものと合わせること）
const COMPANY_NOTIFICATIONS: { when: string; what: string; how: string; who: string }[] = [
  {
    when: "スタッフが業務報告を出した時",
    what: "業務報告が届きました",
    how: "プッシュ（すぐ）",
    who: "そのチームのマネージャー・リーダー（チームの無いシフトは本部）",
  },
  {
    when: "毎日、会社で決めた時刻（未承認の業務報告がある時だけ）",
    what: "業務報告のまとめ（ボタンから承認できる）",
    how: "メール",
    who: "チームの通知用メールアドレス（無ければ会社の通知用メールアドレス）",
  },
  {
    when: "スタッフが募集に応募した時",
    what: "募集に応募がありました",
    how: "プッシュ",
    who: "募集を出したチームのマネージャー・リーダー（チームの無い募集は本部）",
  },
  {
    when: "毎朝10時（未確定のシフト希望がある時だけ）",
    what: "未確定のシフト希望があります",
    how: "メール・プッシュ",
    who: "本部と、希望を出したスタッフのチーム（プッシュを受け取れない人はメール）",
  },
  {
    when: "依頼主がシフトを取り消した時（派遣会社）",
    what: "依頼主がシフトを取り消しました",
    how: "メール・プッシュ",
    who: "会社の通知用メールアドレス・本部",
  },
  {
    when: "依頼主が出勤時間を入力・変更した時（派遣会社）",
    what: "依頼主が出勤時間を変更しました",
    how: "メール・プッシュ",
    who: "会社の通知用メールアドレス・本部",
  },
  {
    when: "配属しているスタッフが依頼主のオーダーに応募した時（派遣会社）",
    what: "依頼主のオーダーにエントリーがありました",
    how: "プッシュ",
    who: "本部",
  },
  {
    when: "業務委託のスタッフが請求書を提出した時",
    what: "請求書が届きました（金額は開いてから）",
    how: "プッシュ",
    who: "本部と、そのスタッフのチームのマネージャー",
  },
  { when: "パスワードでログインした時", what: "ログインのお知らせ", how: "メール", who: "ログインした本人" },
];

// ホーム画面に追加したアプリ（iPhone）では window.print() が何もしないため、スマホ・アプリでは
// 同じ内容のPDF（public/howto/manual.pdf）をアプリ内のPDF表示で開く（「保存・共有」から印刷・保存できる）。
// ※ マニュアルの内容を直したら scripts/generate-manual-pdf.mjs でPDFも作り直すこと。
function isStandaloneOrPhone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.innerWidth < 640
  );
}

function HowToSection() {
  const router = useRouter();
  function printManual() {
    if (isStandaloneOrPhone()) router.push(pdfViewerHref("/howto/manual.pdf"));
    else window.print();
  }
  return (
    <div className="flex flex-col gap-10 print:block">
      <h1 className="hidden font-serif-jp text-lg font-bold text-primary print:mb-2 print:block">TeeRA 使い方マニュアル</h1>
      <SectionCard title="このページを印刷する" className="print-hide">
        <p className="mb-3 text-sm text-muted">
          このページをブラウザの印刷機能で印刷すると、ナビゲーションなどの操作用UIを除いた状態でPDFとして保存できます（印刷ダイアログの「送信先」で「PDFに保存」を選んでください）。
        </p>
        <div className="print-hide flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={printManual}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            🖨 このページを印刷する
          </button>
        </div>
        <nav className="print-hide mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {HOWTO_SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-primary hover:border-primary"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </SectionCard>

      <SectionCard id="howto-dashboard" title="①ダッシュボードで「やること」を確認する">
        <StepGuide
          image="/howto/dashboard.png"
          alt="ダッシュボード画面"
          steps={[
            "ログイン後に最初に開く「ダッシュボード」の上部に、欠員・未確定シフト・業務報告未承認・契約書未確認・有給付与予定などの件数が並ぶ。件数をタップすると内訳が開く",
            "下の「やること」には対応が必要な項目が出る。未確定のシフト希望・未承認の業務報告は「◯件あります（チーム名）」とチームごとに1行にまとまり、タップするとそのチームの一覧が開く",
            "シフトのアサインや業務報告の承認など、元の作業を済ませると該当の行は自動で消える",
            "「＋やることリスト作成」で、本部メンバーやチームのマネージャー／リーダーに向けた独自のやることを、期日と宛先を指定して共有できる。済んだら「解決済みにする」で「解決済み」タブに移る",
          ]}
          note="毎朝ダッシュボードを開いて「やること」が空になっているかを確認するだけで、対応漏れを防げます。ホーム画面に追加したアプリのアイコンには、未確定シフトと未承認の業務報告の件数が数字で出ます。同じ枠の「お知らせ」タブからスタッフへのお知らせ（⑩）、「販促品」タブから販促品の登録ができます。"
        />
      </SectionCard>

      <SectionCard id="howto-staff" title="②スタッフを追加する">
        <StepGuide
          image="/howto/roster-staff-list.png"
          alt="スタッフ名簿の画面"
          steps={[
            "左メニューの「スタッフ名簿」を開く",
            "右上の「＋スタッフを追加」をタップ",
            "「本アカウントを招待」を選ぶと、招待URLが発行される。これをスタッフ本人に送る（LINEやメールなどで構いません）",
            "まだ本人にアカウントを作らせたくない場合は「仮アカウントを作成」で名前だけ登録しておき、後から本招待に切り替えることもできます",
          ]}
          note="スタッフが招待URLから自分で登録すると、名簿に自動で追加されます。"
        />
      </SectionCard>

      <SectionCard id="howto-contract" title="③契約書を用意する">
        <StepGuide
          image="/howto/contracts-template-list.png"
          alt="契約書テンプレート一覧の画面"
          steps={[
            "「設定」→「契約関連」タブを開く",
            "「＋テンプレートを作成」から、雇用形態・業務内容・時給（または月給）などを入力してテンプレートを作る",
            "スタッフ名簿からそのスタッフを開き「契約書管理」→「＋契約書を追加」で、作成したテンプレートを使って契約書を発行する",
            "スタッフのアプリには確認待ちのお知らせが出て、その場で「契約書の内容 → 身分証明書 → 振込先 → 署名（同意）」の順に1つの流れで済ませられる。同意すると契約成立で、控えのPDFが本人にメールで届く",
          ]}
          note="身分証明書・振込先の提出を求めるかは、テンプレートごとに切り替えられます（初期値は求める）。契約書を発行しないと、給与計算の自動計算（勤務内訳の自動反映）が行われません。最初にここを済ませておくのがおすすめです。"
        />
      </SectionCard>

      <SectionCard id="howto-team" printPageBreak title="④チームを作る（複数店舗・複数拠点がある場合）">
        <StepGuide
          image="/howto/settings-basic-team.png"
          alt="チーム管理画面"
          steps={[
            "「設定」→「基本情報」タブの「チーム管理」で「＋チームを作成」",
            "チームごとにマネージャー／リーダーを招待すると、そのチーム内のシフト作成・給与計算などを任せられる",
            "チームの通知先メールアドレスを設定すると、そのチーム宛の業務報告・シフト希望の通知がそちらに届く（未設定なら本部宛に届きます）",
          ]}
          note="1つ目のチームは無料。2つ目以降はチーム作成時にTeeを消費します（画面上に消費量が表示されます）。"
        />
      </SectionCard>

      <SectionCard id="howto-client" title="⑤依頼主を管理する（勤務地・社内メモ）">
        <StepGuide
          image="/howto/client-detail-notes.png"
          alt="依頼主詳細パネルの社内メモ画面"
          steps={[
            "「スタッフ名簿」→「依頼主一覧」から依頼主を開く",
            "「勤務地」「緊急連絡先」を登録しておくと、その依頼主の現場に入るスタッフ全員のシフト画面にも表示される（スタッフに現場情報を個別に伝える手間が省けます）",
            "「社内メモ」タブで「＋メモ作成」。休業日や現場のルールなど、本部・チーム内だけで共有したい内容を書き留められる（画像・PDFを1件のメモに5件まで添付できます）",
            "仮の依頼主（TeeRAを使っていない依頼主）は、業務報告の承認を「その都度」か「月末にまとめて」から選べる（⑫）。契約のときに依頼主に確認して設定しておく",
          ]}
          note="メモは作成時に「スタッフにも共有する」にチェックを入れない限り、本部・管理者側だけに見える内部メモとして保存されます（チェックした分だけ、その依頼主の現場に入るスタッフにも表示されます）。この共有機能は依頼主向けのメモのみで、派遣会社向けのメモには表示されません。"
        />
      </SectionCard>

      <SectionCard id="howto-account" title="⑥通知・ログイン方法を設定する">
        <StepGuide
          image="/howto/account-settings.png"
          alt="アカウント設定画面"
          steps={[
            "画面右上の丸いアイコン（名前の頭文字）をタップし、表示されたメニューの鉛筆マークから「アカウント設定」を開く",
            "「プッシュ通知」をオンにすると、業務報告の提出・募集への応募・未確定のシフト希望などのお知らせが、このブラウザ（スマホ）に届く（どんな時に誰に届くかは㉑）",
            "ログインは、メールアドレスを入れると届くログイン用メールのリンクを開くか、メールに書かれた6桁のコードをアプリに入力する（ホーム画面に追加したアプリではコードが便利です）。「パスワードを設定する」と、メールのあとにパスワードも入れる2段階のログインになり、より安全になる",
            "通知メールのボタンを押すと、24時間以内ならログインせずにそのまま目的の画面が開く。心配な時は「すべての端末からログアウト」で、ログイン中の端末と出してあるボタンをまとめて無効にできる",
          ]}
          note="プッシュ通知は端末（ブラウザ）ごとの設定です。パソコンとスマホの両方で受け取りたい場合は、それぞれでオンにしてください。スマホではホーム画面に追加（下記）してから設定すると確実です。"
        />
      </SectionCard>

      <SectionCard id="howto-shift" printPageBreak title="⑦シフトを作成する">
        <StepGuide
          image="/howto/shift-create-modal.png"
          alt="シフト作成モーダルの画面"
          steps={[
            "左メニューの「シフトカレンダー」を開く",
            "右下の「＋」ボタン→「シフトを作成」をタップ",
            "「社内」か「依頼主・派遣会社向け」かを選び、業務内容を選ぶ（無ければその場で追加できる）",
            "シフトに入れるスタッフを選び、日付・時間を指定して作成する。時間が決まっていなければ「時間未定」で作っておける",
            "時間未定のシフトは、決まったらその日の詳細の時間の横の鉛筆から出勤時間を入れる（その日の分を「まとめて入力」もできる）。入れるとスタッフに通知が届く",
          ]}
        />
        <div className="mt-6 print:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/howto/calendar-overview.png"
            alt="作成したシフトがカレンダーに表示された画面"
            className="w-full rounded-xl border border-border"
          />
          <p className="mt-2 text-xs text-muted">作成するとカレンダーにスタッフ名が表示されます。</p>
        </div>
      </SectionCard>

      <SectionCard id="howto-requests" title="⑧スタッフのシフト希望を確認する">
        <StepGuide
          image="/howto/shift-requests.png"
          alt="シフト希望一覧と日別詳細の画面"
          steps={[
            "スタッフが出勤希望を出すと、「シフトカレンダー」の上部に「シフト希望 ◯件」として日付ごとにまとまって表示される",
            "日付をタップすると、その日に希望を出しているスタッフの一覧が開く",
            "「シフト作成」を押すと、そのスタッフ・その日付が入った状態でシフト作成画面が開く。その日に出している募集があれば、そこへそのままアサインすることもできる",
            "今回は入ってもらわない場合は「見送る」。一覧から消え、スタッフ側には「今回は見送られました」と表示される",
          ]}
          note="日付が過ぎた希望は自動で一覧から消えます。休み希望はこの一覧には出ませんが、休み希望が出ている日にそのスタッフをシフトに入れようとすると警告が表示されます。"
        />
      </SectionCard>

      <SectionCard id="howto-recruit" title="⑨募集を出す（人を集めたいとき）">
        <StepGuide
          image="/howto/recruitment-create.png"
          alt="募集作成画面"
          steps={[
            "「シフトカレンダー」右下の「＋」→「募集を作成」をタップ",
            "シフト作成と同じく1画面ずつ進む：チーム→勤務先→業務内容→時間と日付（複数選択可）→日付ごとの人数（例：2日は2名、3日は1名）",
            "確認画面で内容を確かめて作成。自社スタッフ（配属済みの派遣スタッフを含む）のアプリの「募集」に表示され、各自が応募できる",
            "カレンダーの日付を開き「募集一覧」タブから、応募状況の確認や「スタッフを追加」での直接アサイン、「編集」での人数変更・削除ができる。応募があるとプッシュ通知が届く",
            "集合場所の変更などは「追加のお知らせ」で書き足せる（エントリー済みのスタッフに通知するかは毎回選べます）",
          ]}
          note="募集は無料です。自社スタッフと配属済みの派遣スタッフにだけ表示されます。派遣会社は勤務先で依頼主を選ぶと、依頼主の代わりにその現場の募集を出せ、決まったシフトは依頼主の現場のシフトになります（依頼主のカレンダーには「派遣会社が入力」と出ます）。"
        />
      </SectionCard>

      <SectionCard id="howto-announce" printPageBreak title="⑩スタッフにお知らせを出す">
        <StepGuide
          image="/howto/announcements.png"
          alt="スタッフへのお知らせの作成画面"
          steps={[
            "ダッシュボードの「お知らせ」タブ（または「よく使う操作」）から「＋お知らせを作成」",
            "宛先を「全スタッフ（自社＋派遣）」「自社スタッフのみ」「チームを選ぶ」「個別に選ぶ」から選び、件名・本文を書く（画像・PDFも添付できます）",
            "「お知らせを出す」と、宛先のスタッフにプッシュ通知が届き、スタッフのアプリの「お知らせ」とホームに並ぶ",
          ]}
          note="出した後も鉛筆マークから直したり削除したりできます（直した内容はスタッフ側にも反映され、「編集済み」と出ます）。あとから入ったスタッフにも、宛先に当てはまる過去のお知らせ（個別に選んだものを除く）が届きます。"
        />
      </SectionCard>

      <SectionCard id="howto-timecard" title="⑪タイムカード・業務報告（スタッフ側の画面）">
        <StepGuide
          image="/howto/staff-timecard.png"
          alt="スタッフのタイムカード画面"
          steps={[
            "スタッフはシフト当日、自分のスマホで「タイムカード」を開き「勤務開始」をタップ。休憩時間や業務内容は勤務中いつでも入力できる",
            "終業時に「勤務終了」を押すと、退勤と同時に業務報告が提出される",
            "「勤務終了」を押し忘れた時は、あとからその日のカードで実際の出勤・退勤時刻を入力して提出できる（夜20時になっても未提出ならプッシュ通知でお知らせ）",
            "提出後に間違いに気づいたら、承認されるまではタイムカードの「修正する」から時刻や休憩を直せる。会社側で直す場合は⑫の「時間を直して確認してもらう」",
          ]}
          note="これはスタッフ側の画面です。本部・管理者は次の「業務報告を確認・承認する」で内容を確認します。"
        />
      </SectionCard>

      <SectionCard id="howto-approve" title="⑫業務報告を確認・承認する">
        <StepGuide
          image="/howto/workreports-approval.png"
          alt="業務報告の承認画面"
          steps={[
            "「設定」→「業務報告」タブを開く",
            "スタッフから提出された実働時間・業務内容を確認する",
            "問題なければ「承認する」。時間だけ違う場合は「時間を直して確認してもらう」でこちらから直し、スタッフが確認すると完了。業務内容や出勤/欠勤の区分などが違う場合は「スタッフに直してもらう」で理由を書いて戻す",
          ]}
          note="承認された業務報告だけが、給与計算の勤務内訳に反映されます。仮の依頼主を「月末にまとめて」にしている場合（⑤）、その依頼主の分は月の途中はやること・通知に出ず、月が終わると「〇〇の◯月分の業務報告が◯件、未承認です」の1行から「まとめて承認」できます。"
        />
        <p className="mt-4 rounded-lg bg-background px-4 py-3 text-xs text-muted print:mt-1.5 print:px-2 print:py-1 print:text-[11px] print:leading-snug">
          通知メールアドレス（会社またはチーム）を登録しておくと、1日1回、決めた時刻に業務報告のまとめメールが届きます（未承認の報告があるときだけ）。メール内の「承認する」ボタンからは、アプリを開かずにそのまま承認できます（リンクの有効期限は7日間です。内容を直したい場合はアプリから操作してください）。
        </p>
      </SectionCard>

      <SectionCard id="howto-unscheduled" printPageBreak title="⑬シフト外の勤務を報告してもらう">
        <StepGuide
          image="/howto/unscheduled-report.png"
          alt="スタッフのシフト外の勤務の報告画面"
          steps={[
            "急に呼ばれて出勤した日など、シフトが無いまま働いた日は、スタッフがタイムカード画面の「＋シフト外の勤務を報告する」から報告する",
            "勤務先（自社、または本人が配属されている依頼主）・勤務日・業務内容・出退勤・休憩を入力して提出する",
            "提出すると通常の業務報告と同じく承認待ちに届く（一覧とダッシュボードに「シフト外」の印が付く）。承認すれば給与・請求にも反映される",
          ]}
          note="同じ時間帯にすでにシフトがある日は、そのシフトのカードから報告するよう案内されます。依頼主の現場の報告は、通常のシフトと同じく依頼主側が承認します（仮アカウントの依頼主は自社が承認）。"
        />
      </SectionCard>

      <SectionCard id="howto-paidleave" title="⑭有給休暇を管理する">
        <StepGuide
          image="/howto/paid-leave.png"
          alt="有給休暇の付与画面"
          steps={[
            "「スタッフ名簿」からスタッフを開き、「契約書管理」タブの下にある「有給休暇」欄を見る",
            "入社日を入力して「保存」すると、最初の付与予定日（入社から6ヶ月後）が自動で設定される",
            "付与日が来たら「＋付与する」で日数を入力して付与。次回付与予定日は自動で1年後が提案される（変更も可能）",
            "スタッフが有給を使った日数は、給与明細の作成画面の「有給休暇」欄で入力すると残日数から差し引かれる",
          ]}
          note="付与・使用の入力を間違えた場合は「残日数を訂正する」から増減できます（減らす場合は -1 のようにマイナスで入力）。付与予定日が近づく・過ぎると、ダッシュボードの「有給付与予定」でお知らせします。"
        />
      </SectionCard>

      <SectionCard id="howto-cancelrule" title="⑮依頼主ごとのキャンセル規定を決める">
        <StepGuide
          image="/howto/cancel-rule.png"
          alt="キャンセル規定の設定画面"
          steps={[
            "「スタッフ名簿」→「依頼主一覧」から依頼主を開き、「単価」タブの一番上の「キャンセル規定」で「共通の規定を設定」を押す（その依頼主の全部の業務内容に効く）",
            "「いつでもキャンセルできる」「締切を過ぎたらキャンセル料がかかる」「締切を過ぎたらキャンセルできない」「キャンセルできない」から選ぶ。締切は「勤務日の◯日前の◯時」で指定する",
            "「取り消された時のスタッフの扱い」を選ぶ。請負のように自社で振り替える場合は「調整中にする」、派遣のように依頼主が休みにしたらそのまま休みの場合は「そのまま休みにする」",
          ]}
          note="依頼主がアプリでオーダーを削除・取り消した時は、この規定で計算したキャンセル料（規定でキャンセルできない日なら「規定ではキャンセル不可」）が「依頼主取消」として記録され、キャンセル料はその月の請求書に自動で載ります（依頼主側の削除は止めません）。業務内容によって扱いが違う場合だけ、「＋業務内容ごとに変える」でその業務内容を選んで別の規定にできます（「共通に戻す」で元に戻せます）。何も設定しない場合は「いつでもキャンセルできる・調整中にする」の扱いです。"
        />
      </SectionCard>

      <SectionCard id="howto-share" printPageBreak title="⑯依頼主とシフトを共有する（派遣会社・依頼主がどちらもTeeRAを使う場合）">
        <StepGuide
          image="/howto/client-shared-calendar.png"
          alt="依頼主のカレンダーに派遣会社のシフトが出ている画面"
          steps={[
            "派遣会社が依頼主の現場に入れたシフトは、依頼主のカレンダーにも「派遣：派遣会社名」付きで出る。依頼主は出勤時間の入力・変更ができ、派遣会社に通知が届く",
            "依頼主の出したオーダーには、派遣会社のスタッフが自分で直接エントリーすることもできる（その場合も派遣会社名義のシフトになり、派遣会社の給与・請求に入ります）",
            "派遣会社がスタッフの解除・変更をすると、依頼主側の変更履歴にも残る。依頼主側からは派遣スタッフを外せない（「解除は派遣会社へ」と出ます）",
          ]}
          note="依頼主が書いたオーダーの備考や追加の項目は、派遣会社の「オーダー」タブにも表示されます。"
        />
      </SectionCard>

      <SectionCard id="howto-clientcancel" title="⑰依頼主に取り消された時（調整中・電話で受けた取り消し）">
        <StepGuide
          image="/howto/cancel-shift.png"
          alt="依頼主の現場のシフトを解除する画面"
          steps={[
            "依頼主がアプリでオーダーを削除・取り消すと、規定が「調整中にする」のスタッフは休みにならず「調整中」になる（スタッフには「会社から連絡があります」と表示され、通知は届かない）。カレンダーとダッシュボードの「やること」に出るので、同じ日に別のシフトへ入れて振り替えるか、✕から解除する（依頼主都合とキャンセル料が最初から入っています）",
            "電話などで取り消しを受けた時は、カレンダーでそのシフトの✕を押し、理由で「依頼主都合」を選ぶ。規定からキャンセル料が自動で入る（変更・免除も可）",
            "スタッフを「調整中にしておく」か「休みにする」かを選んで確定する。キャンセル料はその月の請求書に載る",
          ]}
          note="依頼主の現場のシフトを解除する時は、毎回「依頼主都合」か「自社都合」を選ぶまで進めません（キャンセル料の付け忘れを防ぐため）。休みにする時は、スタッフに通知するかどうかを選べます。"
        />
      </SectionCard>

      <SectionCard id="howto-payroll" title="⑱給与明細を作る">
        <StepGuide
          image="/howto/payroll-editor.png"
          alt="給与計算画面"
          steps={[
            "左メニューの「給料明細/請求書」を開く（「給料明細」タブ）",
            "対象のスタッフ・対象月を選ぶと、承認済みの勤務実績が自動で勤務内訳に反映される",
            "必要なら控除（社会保険料など）や有給休暇の使用日数、支払日（カレンダーで選択）・備考を入力する",
            "PDFの載せ方（勤務先・業務ごとに「まとめる」／「1件ずつ」）を選び、内容を確認して「PDFで明細を発行する」。発行するとスタッフのアプリの「給料明細」に届く（本人が電子で受け取ることに同意した場合）",
            "業務委託のスタッフから届いた請求書は、一覧（下書き中の下）で開いて「承認」か「差し戻し」。源泉徴収・消費税はその画面でスタッフごとに決め、承認すると発行履歴に移る",
          ]}
          note="給料の締め日は「設定」の会社情報で選べます（1〜28日・末日）。控除・支払日・備考・載せ方は翌月に引き継がれます。スタッフ個別の業務内容単価は「この日で終了」にでき、それ以降の勤務は契約書の基本給で計算されます。"
        />
        <p className="mt-4 rounded-lg bg-background px-4 py-3 text-xs text-muted print:mt-1.5 print:px-2 print:py-1 print:text-[11px] print:leading-snug">
          発行した後に金額や内容を間違えていたことに気づいた場合は、明細の「内容を修正する」ボタンで一旦下書きに戻して編集できます。同じ対象月の明細であれば、修正後の再発行に追加費用はかかりません（Teeは最初の発行時にしか消費されません）。業務委託のスタッフから届いた請求書は、開く時に1件分（無料の発行枠か1Tee）を使います。同じ人の同じ月は1回だけで、その月の支払明細を発行済みなら無料です。
        </p>
      </SectionCard>

      <SectionCard id="howto-invoice" printPageBreak title="⑲請求書を作る">
        <StepGuide
          image="/howto/invoice-editor.png"
          alt="請求書作成画面"
          steps={[
            "「給料明細/請求書」の「請求書」タブを開く",
            "「＋新しく作成」から請求先の依頼主を選ぶ（依頼主が未登録ならスタッフ名簿の「依頼主一覧」から先に追加する）",
            "明細・消費税区分を確認し、振込先は登録済みのものから選ぶ。PDFの明細の載せ方（業務ごと／スタッフ・業務ごと）も選べ、実績表が付く",
            "内容を確認して「PDFで請求書を発行する」。備考・振込先・載せ方は翌月に引き継がれる",
          ]}
          note="締め日は依頼主の詳細の「編集」で選べます。取り消されたシフトのキャンセル料も明細に載ります。業務内容の単価が未設定の分があると案内が出るので、「単価タブを開く」から設定してください。"
        />
        <p className="mt-4 rounded-lg bg-background px-4 py-3 text-xs text-muted print:mt-1.5 print:px-2 print:py-1 print:text-[11px] print:leading-snug">
          請求書も給与明細と同じく、発行後に「内容を修正する」で下書きに戻して直せます。同じ対象月の請求書であれば、修正しての再発行は何度でも無料です。
        </p>
      </SectionCard>

      <SectionCard id="howto-wallet" title="⑳Tee・プラン（課金の仕組み）">
        <StepGuide
          image="/howto/wallet.png"
          alt="Teeウォレット画面"
          steps={[
            "左メニューの「設定」から行けない場合は、ヘッダー右上の「Tee」表示をタップすると開けます",
            "「Tee」はこのアプリ内で使うポイントで、チャージして使います",
            "給与明細・請求書の発行は、プランの無料発行枠を超えると1件につき1Tee消費します",
            "「プランを選ぶ」から月額プランを変えられる（前のプランは自動で解約されます）。無料プランに戻す時も同じ画面から選べ、今の期間の終わりまでは今のプランのまま使える。誰がいつ変えたかは「購入履歴・利用履歴」に残る",
          ]}
        />
      </SectionCard>

      <SectionCard id="howto-notifications" printPageBreak title="㉑届く通知（いつ・誰に）">
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[640px] border-collapse text-xs print:min-w-0 print:text-[10px] print:leading-snug">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-1.5 pr-3 font-semibold">いつ</th>
                <th className="py-1.5 pr-3 font-semibold">内容</th>
                <th className="py-1.5 pr-3 font-semibold">届き方</th>
                <th className="py-1.5 font-semibold">届く人</th>
              </tr>
            </thead>
            <tbody>
              {COMPANY_NOTIFICATIONS.map((n) => (
                <tr key={n.when} className="border-b border-border/60 align-top last:border-0">
                  <td className="py-1.5 pr-3">{n.when}</td>
                  <td className="py-1.5 pr-3 font-semibold text-primary">{n.what}</td>
                  <td className="py-1.5 pr-3">{n.how}</td>
                  <td className="py-1.5">{n.who}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted print:mt-1.5 print:text-[10px] print:leading-snug">
          「月末にまとめて」承認する依頼主の業務報告は、その月のうちはまとめメールに載らず、月が明けてから届きます。スタッフに届く通知（シフト開始前・出勤時間の変更・給料明細など）は、スタッフ用の使い方（スタッフのアプリの「設定」→「使い方」）に一覧があります。
        </p>
      </SectionCard>

      <SectionCard title="権限ごとに使える機能">
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[640px] border-collapse text-sm print:min-w-0 print:text-[10px]">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 pr-4 font-semibold">役職</th>
                <th className="py-2 pr-4 font-semibold">シフト作成・管理</th>
                <th className="py-2 pr-4 font-semibold">給与計算・請求書・契約書</th>
                <th className="py-2 pr-4 font-semibold">スタッフ・取引先の追加</th>
                <th className="py-2 font-semibold">会社全体の設定</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60">
                <td className="py-2 pr-4 font-semibold text-primary">本部管理者</td>
                <td className="py-2 pr-4">○（全社）</td>
                <td className="py-2 pr-4">○（全社）</td>
                <td className="py-2 pr-4">○（スタッフ・取引先・派遣会社とも）</td>
                <td className="py-2">○</td>
              </tr>
              <tr className="border-b border-border/60">
                <td className="py-2 pr-4 font-semibold text-primary">チームマネージャー</td>
                <td className="py-2 pr-4">○（自チーム内）</td>
                <td className="py-2 pr-4">○（自チーム内）</td>
                <td className="py-2 pr-4">○（スタッフのみ、自チームに追加）</td>
                <td className="py-2">✕</td>
              </tr>
              <tr className="border-b border-border/60">
                <td className="py-2 pr-4 font-semibold text-primary">チームリーダー</td>
                <td className="py-2 pr-4">○（自チーム内）</td>
                <td className="py-2 pr-4">✕（閲覧も不可）</td>
                <td className="py-2 pr-4">✕</td>
                <td className="py-2">✕</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-semibold text-primary">スタッフ</td>
                <td className="py-2 pr-4">自分のシフト提出のみ</td>
                <td className="py-2 pr-4">✕</td>
                <td className="py-2 pr-4">✕</td>
                <td className="py-2">✕</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-4 list-disc pl-5 text-sm text-muted print:mt-2 print:text-[10px]">
          <li>本部管理者を全員外す操作（最後の1人の降格・削除など）はできません。</li>
          <li>取引先・派遣会社の新規作成は本部管理者のみ行えます。仮アカウントを作成する際にチームを指定すれば、作成後すぐにそのチームに紐付けられます。</li>
        </ul>
      </SectionCard>

      <SectionCard title="スマートフォンのホーム画面に追加する">
        <div className="flex flex-col gap-4 text-sm print:gap-2 print:text-[10.5px]">
          <div>
            <p className="mb-1 font-semibold text-primary">iPhone（Safari）</p>
            <ol className="list-decimal pl-5 text-muted">
              <li>SafariでTeeRAを開く</li>
              <li>画面下の共有ボタン（□に↑）をタップ</li>
              <li>「ホーム画面に追加」を選び、「追加」をタップ</li>
            </ol>
          </div>
          <div>
            <p className="mb-1 font-semibold text-primary">Android（Chrome）</p>
            <ol className="list-decimal pl-5 text-muted">
              <li>ChromeでTeeRAを開く</li>
              <li>右上の「︙」メニューをタップ</li>
              <li>「アプリをインストール」または「ホーム画面に追加」を選ぶ</li>
            </ol>
          </div>
          <p className="text-muted">ホーム画面に追加すると、アプリのように起動でき、通知にもすぐ気づきやすくなります。</p>
        </div>
      </SectionCard>
    </div>
  );
}

// printPageBreak: 使い方マニュアルを印刷した時、この項目から新しいページに
// する（1ページ3項目に固定するため、④⑦⑩⑬⑯⑲と㉑（通知の一覧・権限表・ホーム画面追加を同じページに）の前で改ページ）。
function SectionCard({
  id,
  title,
  headerAction,
  printPageBreak,
  className,
  children,
}: {
  id?: string;
  title: React.ReactNode;
  headerAction?: React.ReactNode;
  printPageBreak?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`print-avoid-break rounded-2xl border border-border bg-white/60 p-6 scroll-mt-20 print:mb-3 print:rounded-lg print:p-3 print:last:mb-0 ${id?.startsWith("howto-") ? "print:min-h-[80mm]" : ""} ${printPageBreak ? "print-page-break" : ""} ${className ?? ""}`}
    >
      <div className="mb-4 flex items-center justify-between print:mb-1.5">
        <h2 className="font-serif-jp text-lg font-bold text-primary print:text-base">{title}</h2>
        {headerAction}
      </div>
      {children}
    </section>
  );
}

// 印鑑の画像を、白っぽい背景を透過・余白を切り詰め・縮小したPNG（data URL）に
// する。紙に押した印をスマホで撮った画像でも、請求書に重ねたとき白い四角が
// 残らないようにするため。
const SEAL_MAX_PX = 300;
async function processSealImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("load_failed"));
      el.src = url;
    });
    const scale = Math.min(1, (SEAL_MAX_PX * 2) / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    const px = image.data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // 一番暗い色成分で「どれだけ白に近いか」を見る。220以上は背景として
        // 透明に、170〜220は境目をなめらかにするため段階的に透過する。
        const lightness = Math.min(px[i], px[i + 1], px[i + 2]);
        const alpha = lightness >= 220 ? 0 : lightness > 170 ? Math.round(((220 - lightness) / 50) * 255) : 255;
        px[i + 3] = Math.min(px[i + 3], alpha);
        if (px[i + 3] > 20) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) throw new Error("empty_image");
    ctx.putImageData(image, 0, 0);
    // 印の部分だけを切り出し、長辺SEAL_MAX_PXに縮める
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const outScale = Math.min(1, SEAL_MAX_PX / Math.max(cw, ch));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cw * outScale));
    out.height = Math.max(1, Math.round(ch * outScale));
    out.getContext("2d")!.drawImage(canvas, minX, minY, cw, ch, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 請求書の発行元に押す電子印（社印）。本部の管理者/編集者だけに表示する。
const SEAL_OPACITY_OPTIONS = [
  { value: 30, label: "薄め" },
  { value: 45, label: "標準" },
  { value: 70, label: "濃いめ" },
];

function SealSection({
  companyName,
  sealImageDataUrl,
  sealOpacity,
}: {
  companyName: string;
  sealImageDataUrl: string | null;
  sealOpacity: number;
}) {
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(sealOpacity);
  const [error, setError] = useState<string | null>(null);
  const shown = preview ?? sealImageDataUrl;

  // 濃さは選んだ時点で保存する（プレビューにもすぐ反映）
  function chooseOpacity(value: number) {
    setOpacity(value);
    startTransition(async () => {
      try {
        await updateCompanySealOpacityAction(value);
      } catch {
        setError("濃さを保存できませんでした。");
      }
    });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setPreview(await processSealImage(file));
    } catch {
      setError("画像を読み込めませんでした。印鑑がはっきり写った画像を選んでください。");
    }
  }

  function save(value: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        await updateCompanySealAction(value);
        setPreview(null);
      } catch {
        setError("保存できませんでした。画像を小さくして試してください。");
      }
    });
  }

  return (
    <SectionCard title="電子印（請求書）">
      <p className="mb-3 text-xs text-muted">
        印鑑の画像をアップロードすると、請求書の発行元（会社名・住所など）の後ろに薄く表示されます。白い背景は自動で透明になります。発行済みの請求書は、発行したときの印のままです。
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {/* 請求書での見え方のプレビュー（発行元の文字の後ろに薄く敷く） */}
        <div className="rounded-lg border border-border bg-white px-6 py-5 text-right">
          <div className="relative inline-block">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URLのプレビュー
              <img
                src={shown}
                alt="電子印"
                style={{ opacity: opacity / 100 }}
                className="absolute right-0 top-0 h-14 w-14 object-contain"
              />
            ) : null}
            <p className="relative text-sm font-bold text-primary">{companyName}</p>
            <p className="relative text-[10px] text-muted">千葉県〇〇市〇〇1-2-3</p>
            <p className="relative text-[10px] text-muted">TEL: 000-000-0000</p>
            <p className="relative text-[10px] text-muted">登録番号: T0000000000000</p>
          </div>
          <p className="mt-2 text-[10px] text-muted">請求書での表示イメージ</p>
        </div>
        <div className="flex flex-col gap-2">
          <label className="cursor-pointer rounded-lg border border-primary px-3 py-1.5 text-center text-xs font-semibold text-primary">
            {sealImageDataUrl || preview ? "画像を選び直す" : "印鑑の画像を選ぶ"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {preview ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => save(preview)}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                この印で保存する
              </button>
              {/* 選んだ画像を保存せずに取り消す（保存済みの印はそのまま） */}
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
                className="text-xs text-muted hover:text-primary disabled:opacity-60"
              >
                キャンセル
              </button>
            </>
          ) : null}
          {sealImageDataUrl && !preview ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => save(null)}
              className="text-xs text-muted hover:text-red-600 disabled:opacity-60"
            >
              電子印を削除
            </button>
          ) : null}
        </div>
      </div>
      {shown ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">濃さ</span>
          {SEAL_OPACITY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={pending}
              onClick={() => chooseOpacity(o.value)}
              className={`rounded-full border px-3 py-1 disabled:opacity-60 ${
                opacity === o.value ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </SectionCard>
  );
}

// チームマネージャー向け：会社名・住所・電話番号だけを表示する（編集不可）
function CompanyInfoReadOnly({
  companyName,
  address,
  phoneNumber,
}: {
  companyName: string;
  address: string;
  phoneNumber: string;
}) {
  return (
    <SectionCard title="会社情報">
      <dl className="grid grid-cols-[90px_1fr] gap-y-2 text-sm">
        <dt className="text-muted">会社名</dt>
        <dd>{companyName}</dd>
        <dt className="text-muted">住所</dt>
        <dd>{address || "—"}</dd>
        <dt className="text-muted">電話番号</dt>
        <dd>{phoneNumber || "—"}</dd>
      </dl>
    </SectionCard>
  );
}

function CompanyInfoSection({
  companyName,
  invoiceRegistrationNumber,
  address,
  phoneNumber,
  notificationEmail,
  workReportDigestHour,
  payrollClosingDay,
}: {
  companyName: string;
  invoiceRegistrationNumber: string;
  address: string;
  phoneNumber: string;
  notificationEmail: string;
  workReportDigestHour: number;
  payrollClosingDay: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(companyName);
  const [regNumber, setRegNumber] = useState(invoiceRegistrationNumber);
  const [addressValue, setAddressValue] = useState(address);
  const [phoneValue, setPhoneValue] = useState(phoneNumber);
  const [notificationEmailValue, setNotificationEmailValue] = useState(notificationEmail);
  const [digestHourValue, setDigestHourValue] = useState(workReportDigestHour);
  const [closingDayValue, setClosingDayValue] = useState(payrollClosingDay === null ? "" : String(payrollClosingDay));
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <SectionCard title="会社情報">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 sm:gap-x-10">
            <div>
              <p className="text-xs text-muted">会社名</p>
              <p className="font-medium">{name}</p>
            </div>
            <div>
              <p className="text-xs text-muted">住所</p>
              <p className="font-medium">{addressValue || "未登録"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">電話番号</p>
              <p className="font-medium">{phoneValue || "未登録"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">登録番号（インボイス番号）</p>
              <p className="font-medium">{regNumber || "未登録"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">通知メールアドレス</p>
              <p className="font-medium">{notificationEmailValue || "未設定（通知メールは送信されません）"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">業務報告のまとめメール</p>
              <p className="font-medium">毎日 {digestHourValue}:00</p>
            </div>
            <div>
              <p className="text-xs text-muted">給料の締め日（給料明細・業務委託スタッフの請求書）</p>
              <p className="font-medium">{closingDayLabel(closingDayValue ? Number(closingDayValue) : null)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-lg border border-accent bg-accent/20 px-4 py-2 text-sm font-semibold text-primary"
          >
            <span className="inline-block scale-x-[-1]">✎</span> 変更
          </button>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="会社情報">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs">
          会社名
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          住所
          <input
            type="text"
            value={addressValue}
            onChange={(e) => setAddressValue(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          電話番号
          <input
            type="text"
            value={phoneValue}
            onChange={(e) => setPhoneValue(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          登録番号（インボイス番号）
          <input
            type="text"
            value={regNumber}
            onChange={(e) => setRegNumber(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          通知メールアドレス（業務報告の提出・シフト希望のたまり・販促品の受注をお知らせします。空欄なら送信しません）
          <input
            type="email"
            value={notificationEmailValue}
            onChange={(e) => setNotificationEmailValue(e.target.value)}
            placeholder="例：shift@your-company.com"
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          業務報告のまとめメールを送る時刻（届くたびではなく、1日1回この時刻に前回からの分をまとめて送ります）
          <select
            value={digestHourValue}
            onChange={(e) => setDigestHourValue(Number(e.target.value))}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                毎日 {h}:00
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          給料の締め日（給料明細・業務委託スタッフの請求書の対象期間。例：20日締めなら「11月分」は10/21〜11/20の勤務）
          <select
            value={closingDayValue}
            onChange={(e) => setClosingDayValue(e.target.value)}
            aria-label="給料の締め日"
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            {CLOSING_DAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await updateCompanyNameAction(name);
                await updateCompanyInvoiceRegistrationNumberAction(regNumber);
                await updateCompanyAddressAction(addressValue);
                await updateCompanyPhoneNumberAction(phoneValue);
                await updateCompanyNotificationEmailAction(notificationEmailValue);
                await updateCompanyWorkReportDigestHourAction(digestHourValue);
                await updateCompanyPayrollClosingDayAction(closingDayValue ? Number(closingDayValue) : null);
                setEditing(false);
              })
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg border border-border px-4 py-2 text-sm"
          >
            キャンセル
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

function AdminsSection({ admins, staff }: { admins: Admin[]; staff: StaffOption[] }) {
  const [pending, startTransition] = useTransition();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  // ＋招待：新しく招待する（URL発行）か、既に所属しているスタッフから選ぶ
  const [inviteMode, setInviteMode] = useState<"closed" | "new" | "existing">("closed");
  const [promoteUserId, setPromoteUserId] = useState("");
  const closeInvite = () => {
    setInviteMode("closed");
    setInviteUrl(null);
    setPromoteUserId("");
  };
  const adminIds = new Set(admins.map((a) => a.userId));
  const promotableStaff = staff.filter((s) => !adminIds.has(s.userId));
  const [error, setError] = useState<string | null>(null);
  const [removeConfirmTarget, setRemoveConfirmTarget] = useState<{ userId: string; name: string } | null>(null);
  const [detailTarget, setDetailTarget] = useState<Admin | null>(null);
  const adminCount = admins.filter((a) => a.role === "COMPANY_ADMIN").length;

  const canWorkCheckbox = (a: Admin) => (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <input
        type="checkbox"
        defaultChecked={a.canWorkShifts}
        disabled={pending}
        onChange={(e) => startTransition(() => setMemberCanWorkShiftsAction(a.userId, e.target.checked))}
      />
      このメンバーはシフトにも入れる
    </label>
  );

  const removeButton = (a: Admin, isLastAdmin: boolean) => (
    <button
      type="button"
      disabled={pending || isLastAdmin}
      title={isLastAdmin ? "本部管理者は最低1名必要です" : undefined}
      onClick={() => {
        setDetailTarget(null);
        setRemoveConfirmTarget({ userId: a.userId, name: a.name });
      }}
      className="text-xs text-muted hover:text-red-600 disabled:opacity-40"
    >
      権限を外す
    </button>
  );

  return (
    <SectionCard title="本部メンバー権限">
      <ul className="mb-4 divide-y divide-border/60 rounded-lg border border-border sm:hidden">
        {admins.map((a) => (
          <li key={a.userId}>
            <button
              type="button"
              onClick={() => setDetailTarget(a)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm"
            >
              <span className="font-medium">{a.name}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                本部管理者
                <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden>
                  <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mb-4 hidden overflow-x-auto sm:block">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">氏名</th>
            <th className="py-2">メール</th>
            <th className="py-2">権限</th>
            <th className="py-2">兼務</th>
            <th className="py-2">権限を外す</th>
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => {
            const isLastAdmin = adminCount <= 1;
            return (
              <tr key={a.userId} className="border-b border-border/60">
                <td className="py-2">{a.name}</td>
                <td className="py-2 text-muted">{a.email}</td>
                <td className="py-2">本部管理者</td>
                <td className="py-2">{canWorkCheckbox(a)}</td>
                <td className="py-2">{removeButton(a, isLastAdmin)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {detailTarget ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4 sm:hidden"
          onClick={() => setDetailTarget(null)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-serif-jp text-lg font-bold text-primary">{detailTarget.name}</h3>
              <button type="button" onClick={() => setDetailTarget(null)} className="text-muted">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-4 text-sm">
              <p className="text-muted">{detailTarget.email}</p>
              <div>
                <p className="mb-1 text-xs text-muted">権限</p>
                <p className="text-sm">本部管理者</p>
              </div>
              {canWorkCheckbox(detailTarget)}
              <div className="border-t border-border pt-3">
                {removeButton(detailTarget, adminCount <= 1)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {removeConfirmTarget ? (
        <ConfirmDialog
          message={`「${removeConfirmTarget.name}」の本部管理者権限を外し、一般スタッフに戻します。よろしいですか？`}
          confirmLabel="権限を外す"
          pending={pending}
          onConfirm={() =>
            startTransition(async () => {
              setError(null);
              const result = await removeCompanyMemberRoleAction(removeConfirmTarget.userId);
              if (result.error) setError("本部管理者は最低1名必要なため、外せませんでした。");
              setRemoveConfirmTarget(null);
            })
          }
          onCancel={() => setRemoveConfirmTarget(null)}
        />
      ) : null}

      {inviteMode === "closed" ? (
        <button
          type="button"
          onClick={() => setInviteMode("new")}
          className="rounded-lg border border-primary px-4 py-2 text-sm text-primary"
        >
          ＋招待
        </button>
      ) : (
        // チームの「＋招待」（TeamInviteForm）と同じ見た目にそろえる
        <div className="rounded-lg border border-border bg-background/40 p-3 text-sm">
          <div className="mb-3 inline-flex rounded-lg border border-border bg-white p-0.5 text-xs">
            {(
              [
                ["new", "新しく招待する"],
                ["existing", "既存スタッフから選ぶ"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setInviteMode(mode)}
                className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
                  inviteMode === mode ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            {inviteMode === "existing" ? (
              promotableStaff.length === 0 ? (
                <p className="text-xs text-muted">本部管理者にできる既存スタッフがいません。</p>
              ) : (
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted">スタッフ</span>
                  <select
                    aria-label="本部管理者にするスタッフ"
                    value={promoteUserId}
                    onChange={(e) => setPromoteUserId(e.target.value)}
                    className="rounded-lg border border-border px-2 py-1.5 text-sm text-foreground"
                  >
                    <option value="">スタッフを選択</option>
                    {promotableStaff.map((s) => (
                      <option key={s.userId} value={s.userId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )
            ) : null}

            {inviteMode === "new" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const url = await inviteCompanyAdminAction("COMPANY_ADMIN");
                    setInviteUrl(url);
                  })
                }
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                招待URLを発行する
              </button>
            ) : promotableStaff.length > 0 ? (
              <button
                type="button"
                disabled={pending || !promoteUserId}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    try {
                      await promoteStaffToCompanyAdminAction(promoteUserId);
                      closeInvite();
                    } catch {
                      setError("本部管理者にできませんでした。");
                    }
                  })
                }
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                本部管理者にする
              </button>
            ) : null}
            <button type="button" onClick={closeInvite} className="rounded-lg border border-border px-3 py-1.5 text-xs">
              キャンセル
            </button>
          </div>

          {inviteMode === "new" && inviteUrl ? (
            <div className="mt-2">
              <CopyUrlField url={inviteUrl} size="sm" />
            </div>
          ) : null}
          {inviteMode === "existing" && promotableStaff.length > 0 ? (
            <p className="mt-2 text-xs text-muted">
              シフトにはこれまで通り入れます（「このメンバーはシフトにも入れる」がオンになります）。チームでの役職もそのままです。
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function TeamHeaderEditor({
  teamId,
  name,
  notificationEmail,
}: {
  teamId: string;
  name: string;
  notificationEmail: string;
}) {
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(name);
  const [emailValue, setEmailValue] = useState(notificationEmail);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="mb-3">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">{name}</span>
          <button
            type="button"
            onClick={() => {
              setNameValue(name);
              setEmailValue(notificationEmail);
              setEditing(true);
            }}
            aria-label="チーム名・通知先を変更"
            className="text-xs text-muted hover:text-primary"
          >
            <span className="inline-block scale-x-[-1]">✎</span>
          </button>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted">
          通知先：{notificationEmail || "未設定"}
          <InfoPopupButton title="チーム宛メールの通知先">
            チーム宛メール通知は未設定だと届きません。業務報告の提出・シフト希望の未確定件数をこのチームのマネージャー/リーダーに知らせたい場合に設定してください。
          </InfoPopupButton>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-3">
      <label className="flex flex-col gap-1 text-xs">
        チーム名
        <input
          type="text"
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          className="rounded-lg border border-border px-2 py-1 text-sm font-semibold"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        通知用メールアドレス（任意）
        <input
          type="email"
          value={emailValue}
          onChange={(e) => setEmailValue(e.target.value)}
          placeholder="例：team-a@your-company.com"
          className="rounded-lg border border-border px-2 py-1 text-sm"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !nameValue.trim()}
          onClick={() =>
            startTransition(async () => {
              await updateTeamNameAction(teamId, nameValue.trim());
              await updateTeamNotificationEmailAction(teamId, emailValue);
              setEditing(false);
            })
          }
          className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          保存
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted">
          キャンセル
        </button>
      </div>
    </div>
  );
}

// managerMode＝チームマネージャーが見る自チームだけの画面。チームの作成・
// 名前/通知先の変更はできず、マネージャー/リーダーの招待・変更・解除だけできる
// （自分自身の役職は変えられない）。
function TeamsSection({
  teams,
  staff,
  teeBalance,
  managerMode = false,
  currentUserId,
  openCreate = false,
}: {
  teams: Team[];
  staff: StaffOption[];
  teeBalance: number;
  managerMode?: boolean;
  currentUserId: string;
  openCreate?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [inviteFormTeamId, setInviteFormTeamId] = useState<string | null>(null);
  // チームを作れるのは本部だけ（チームマネージャーの画面には作成ボタンが無い）
  const [showCreateModal, setShowCreateModal] = useState(openCreate && !managerMode);
  const [removeConfirmTarget, setRemoveConfirmTarget] = useState<{ teamId: string; userId: string; name: string } | null>(
    null,
  );

  const nextTeamRequiresTee = teams.length > 0;
  const canAffordNextTeam = !nextTeamRequiresTee || teeBalance >= TEAM_UNLOCK_TEE_COST;

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-1.5">
          チーム管理
          <InfoPopupButton title="チーム管理">
            ここに載るのはチームのマネージャー/リーダーだけです。一般スタッフのチーム所属はスタッフ名簿の各スタッフ詳細から、依頼主/派遣会社との紐付けは各企業詳細から変更できます。1チーム目は無料、2チーム目以降は1チームにつき{TEAM_UNLOCK_TEE_COST}
                {" "}Teeで作成できます（プラン不問）。
          </InfoPopupButton>
        </span>
      }
      headerAction={
        managerMode ? undefined : (
          <button
            type="button"
            disabled={!canAffordNextTeam}
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            ＋チームを作成
          </button>
        )
      }
    >
      <div className="flex flex-col gap-6">
        {teams.map((team) => {
          const managers = team.members.filter((m) => m.role === "TEAM_MANAGER" || m.role === "TEAM_LEADER");
          return (
          <div key={team.id} className="rounded-xl border border-border p-4">
            {managerMode ? (
              <h3 className="mb-3 font-semibold">{team.name}</h3>
            ) : (
              <TeamHeaderEditor teamId={team.id} name={team.name} notificationEmail={team.notificationEmail} />
            )}

            {managers.length > 0 ? (
              <>
              <div className="mb-2 hidden overflow-x-auto sm:block">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="py-2">氏名</th>
                    <th className="py-2">メール</th>
                    <th className="py-2">権限</th>
                    <th className="py-2">権限を外す</th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map((m) => (
                    <tr key={m.userId} className="border-b border-border/60">
                      <td className="py-2">{m.name}</td>
                      <td className="py-2 text-muted">{m.email}</td>
                      <td className="py-2">
                        <select
                          defaultValue={m.role}
                          disabled={pending || (managerMode && m.userId === currentUserId)}
                          onChange={(e) =>
                            startTransition(() =>
                              setTeamMemberRoleAction(
                                team.id,
                                m.userId,
                                e.target.value as "TEAM_MANAGER" | "TEAM_LEADER",
                              ),
                            )
                          }
                          className="rounded-lg border border-border px-2 py-1 text-xs"
                        >
                          <option value="TEAM_MANAGER">マネージャー</option>
                          <option value="TEAM_LEADER">リーダー</option>
                        </select>
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          disabled={pending || (managerMode && m.userId === currentUserId)}
                          onClick={() => setRemoveConfirmTarget({ teamId: team.id, userId: m.userId, name: m.name })}
                          className="text-xs text-muted hover:text-red-600 disabled:opacity-60"
                        >
                          権限を外す
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

              <div className="mb-2 flex flex-col gap-2 sm:hidden">
                {managers.map((m) => (
                  <div key={m.userId} className="rounded-lg border border-border/60 p-2.5 text-sm">
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-muted">{m.email}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <select
                        defaultValue={m.role}
                        disabled={pending || (managerMode && m.userId === currentUserId)}
                        onChange={(e) =>
                          startTransition(() =>
                            setTeamMemberRoleAction(
                              team.id,
                              m.userId,
                              e.target.value as "TEAM_MANAGER" | "TEAM_LEADER",
                            ),
                          )
                        }
                        className="rounded-lg border border-border px-2 py-1 text-xs"
                      >
                        <option value="TEAM_MANAGER">マネージャー</option>
                        <option value="TEAM_LEADER">リーダー</option>
                      </select>
                      <button
                        type="button"
                        disabled={pending || (managerMode && m.userId === currentUserId)}
                        onClick={() => setRemoveConfirmTarget({ teamId: team.id, userId: m.userId, name: m.name })}
                        className="text-xs text-muted hover:text-red-600 disabled:opacity-60"
                      >
                        権限を外す
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              </>
            ) : (
              <p className="mb-2 text-xs text-muted">まだマネージャー/リーダーがいません。</p>
            )}

            <div className="mt-3 border-t border-border pt-3">
              {inviteFormTeamId === team.id ? (
                <TeamInviteForm
                  teamId={team.id}
                  // 既に一般メンバーとしてこのチームに所属している人も、ここから
                  // マネージャー/リーダーへ直接昇格できるように含める（既に
                  // マネージャー/リーダーの人だけ除外する）。以前は所属済みなら
                  // 誰でも一律除外していたため、一般メンバーを直接昇格させる
                  // 方法がUI上に存在しなかった。
                  // マネージャーは自チームに所属している人の中からだけ選べる
                  staffOptions={(managerMode
                    ? team.members.map((m) => ({ userId: m.userId, name: m.name }))
                    : staff
                  ).filter((s) => {
                    const existingRole = team.members.find((m) => m.userId === s.userId)?.role;
                    return existingRole !== "TEAM_MANAGER" && existingRole !== "TEAM_LEADER";
                  })}
                  onDone={() => setInviteFormTeamId(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setInviteFormTeamId(team.id)}
                  className="rounded-lg border border-primary px-3 py-1.5 text-xs text-primary"
                >
                  ＋招待
                </button>
              )}
            </div>

          </div>
          );
        })}
        {teams.length === 0 ? (
          <p className="text-xs text-muted">チームはまだありません。</p>
        ) : null}
      </div>

      {showCreateModal ? (
        <CreateTeamModal
          staff={staff}
          teeCost={nextTeamRequiresTee ? TEAM_UNLOCK_TEE_COST : 0}
          onClose={() => setShowCreateModal(false)}
        />
      ) : null}

      {removeConfirmTarget ? (
        <ConfirmDialog
          message={`「${removeConfirmTarget.name}」のチーム管理者/リーダー権限を外します。よろしいですか？`}
          confirmLabel="権限を外す"
          pending={pending}
          onConfirm={() =>
            startTransition(async () => {
              await setTeamMemberRoleAction(removeConfirmTarget.teamId, removeConfirmTarget.userId, "TEAM_MEMBER");
              setRemoveConfirmTarget(null);
            })
          }
          onCancel={() => setRemoveConfirmTarget(null)}
        />
      ) : null}
    </SectionCard>
  );
}

function CreateTeamModal({
  staff,
  teeCost,
  onClose,
}: {
  staff: StaffOption[];
  teeCost: number;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [role, setRole] = useState<"TEAM_MANAGER" | "TEAM_LEADER">("TEAM_MANAGER");

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">チームを作成</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>

        <label className="mb-4 flex flex-col gap-1 text-xs text-muted">
          チーム名
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="新しいチーム名"
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="mb-1 flex flex-col gap-1 text-xs text-muted">
          担当者（任意）
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
          >
            <option value="">割り当てない</option>
            {staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {assigneeId ? (
          <label className="mb-4 mt-2 flex flex-col gap-1 text-xs text-muted">
            権限
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "TEAM_MANAGER" | "TEAM_LEADER")}
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
            >
              <option value="TEAM_MANAGER">マネージャー</option>
              <option value="TEAM_LEADER">リーダー</option>
            </select>
          </label>
        ) : (
          <div className="mb-4" />
        )}

        {teeCost > 0 ? (
          <p className="mb-3 text-xs text-muted">このチームの作成に{teeCost} Teeを消費します。</p>
        ) : null}

        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() =>
            startTransition(async () => {
              await createTeamAction(name.trim(), assigneeId ? { userId: assigneeId, role } : undefined);
              onClose();
            })
          }
          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          作成
        </button>
      </div>
    </div>
  );
}

function TeamInviteForm({
  teamId,
  staffOptions,
  onDone,
}: {
  teamId: string;
  staffOptions: StaffOption[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [role, setRole] = useState<"TEAM_MANAGER" | "TEAM_LEADER">("TEAM_MANAGER");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState(staffOptions[0]?.userId ?? "");

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 text-sm">
      <div className="mb-3 inline-flex rounded-lg border border-border bg-white p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setMode("new")}
          className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
            mode === "new" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          新しく招待する
        </button>
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
            mode === "existing" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          既存スタッフから選ぶ
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {mode === "existing" ? (
          staffOptions.length === 0 ? (
            <p className="text-xs text-muted">追加できる既存スタッフがいません。</p>
          ) : (
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-muted">スタッフ</span>
              <select
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="rounded-lg border border-border px-2 py-1.5 text-sm text-foreground"
              >
                {staffOptions.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : null}

        {mode === "existing" ? (
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="text-muted">権限</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "TEAM_MANAGER" | "TEAM_LEADER")}
              className="rounded-lg border border-border px-2 py-1.5 text-sm text-foreground"
            >
              <option value="TEAM_MANAGER">マネージャー</option>
              <option value="TEAM_LEADER">リーダー</option>
            </select>
          </label>
        ) : null}

        {mode === "new" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                // 招待の時点では権限を選ばせず、まずリーダーとして招待する。
                // マネージャーへの昇格は参加後、上の一覧の「権限」セレクトから
                // 行う（招待URL発行のたびに権限を選ばせるのは煩雑なだけで、
                // 参加前に決め打ちする必要が無いため）。
                const url = await inviteTeamManagerAction(teamId, "TEAM_LEADER");
                setInviteUrl(url);
              })
            }
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            招待URLを発行する
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || !selectedStaffId}
            onClick={() =>
              startTransition(async () => {
                await promoteExistingStaffToTeamRoleAction(teamId, selectedStaffId, role);
                onDone();
              })
            }
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            追加する
          </button>
        )}
        <button type="button" onClick={onDone} className="rounded-lg border border-border px-3 py-1.5 text-xs">
          キャンセル
        </button>
      </div>

      {inviteUrl ? (
        <div className="mt-2">
          <CopyUrlField url={inviteUrl} size="sm" />
        </div>
      ) : null}
    </div>
  );
}
