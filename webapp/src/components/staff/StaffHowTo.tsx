"use client";

import { useRouter } from "next/navigation";
import { pdfViewerHref } from "@/lib/pdfViewerHref";

// スタッフ向けの使い方マニュアル。会社向け（設定の「使い方」）と同じく、印刷すると1ページ3項目に収まる。
// ホーム画面に追加したアプリ（iPhone）では印刷が効かないので、スマホでは同じ内容のPDF
// （public/howto/staff-manual.pdf）をアプリ内で開く。
// ※ 内容を直したら scripts/generate-manual-pdf.mjs でPDFも作り直すこと。
const SECTIONS: { id: string; title: string; image: string; steps: string[]; note?: string; pageBreak?: boolean }[] = [
  {
    id: "staff-howto-login",
    title: "①アプリをホーム画面に追加してログインする",
    image: "/howto/staff-login.png",
    steps: [
      "会社から届いた招待URLを開いて、名前とメールアドレスを登録する",
      "iPhoneはSafariの共有ボタン（□に↑）→「ホーム画面に追加」、AndroidはChromeの「︙」→「ホーム画面に追加」で、アプリのように使える",
      "ログインは、メールアドレスを入れると届くメールの6桁のコードをアプリに入力する（メールのリンクを開いてもログインできます）",
    ],
    note: "右上の丸いアイコン→鉛筆マークの「アカウント設定」で、プッシュ通知をオンにしておくと、シフトやお知らせにすぐ気づけます。",
  },
  {
    id: "staff-howto-calendar",
    title: "②カレンダーで自分のシフトを見る",
    image: "/howto/staff-calendar.png",
    steps: [
      "メニューの「カレンダー」に、自分のシフトが勤務先の名前つきで出る",
      "日付をタップすると、その日の時間・業務内容・勤務地などが見られる",
      "出勤時間が「未定」のシフトは、時間が決まると通知が届き、カレンダーにも反映される",
    ],
    note: "「調整中」と出ているシフトは、勤務先の都合で調整しています。会社からの連絡を待ってください。",
  },
  {
    id: "staff-howto-request",
    title: "③シフト希望を出す",
    image: "/howto/staff-shift-request.png",
    steps: [
      "カレンダー右下の「＋」（または日付をタップして「＋シフト希望を作成」）",
      "日付を選び、「出勤希望」か「休み希望」かを選んで送る（何日分かまとめて出せます）",
      "会社がシフトを作ると、カレンダーにシフトとして出る",
    ],
  },
  {
    id: "staff-howto-recruit",
    title: "④募集に応募する",
    image: "/howto/staff-recruitments.png",
    steps: [
      "メニューの「募集」に、会社や配属先から出ている募集が並ぶ",
      "タップして業務内容・時間・備考などを確かめ、「応募する」",
      "応募すると、そのままシフトとして確定し、カレンダーに出る",
    ],
    note: "自分のシフトと時間が重なる募集や、満員の募集は出ません。",
    pageBreak: true,
  },
  {
    id: "staff-howto-timecard",
    title: "⑤タイムカード（勤務開始・勤務終了）",
    image: "/howto/staff-timecard-mobile.png",
    steps: [
      "勤務の日は「タイムカード」を開き、着いたら「勤務開始」",
      "休憩時間や業務内容は、勤務中いつでも入力できる",
      "終わったら「勤務終了」。退勤と同時に業務報告が会社に届く",
      "押し忘れた時は、あとでその日のカードに実際の時刻を入れて提出する。提出後も、承認される前なら「修正する」で直せる",
    ],
    note: "会社が時刻を直したときは「要確認」になります。内容を確かめて確認してください。",
  },
  {
    id: "staff-howto-unscheduled",
    title: "⑥シフトが無い日に働いた時（シフト外の勤務）",
    image: "/howto/staff-unscheduled.png",
    steps: [
      "急に呼ばれて働いた日など、シフトが無い日は、タイムカードの「＋シフト外の勤務を報告する」",
      "勤務先・日付・業務内容・出勤と退勤の時刻・休憩を入れて提出する",
      "会社が承認すると、ほかの勤務と同じように給料に反映される",
    ],
  },
  {
    id: "staff-howto-contract",
    title: "⑦契約書を確認して同意する",
    image: "/howto/staff-contract.png",
    steps: [
      "会社から契約書が届くと、アプリを開いたときに確認の画面が出る",
      "「契約書の内容 → 身分証明書 → 振込先 → 署名」の順に進めて、最後に「同意する」",
      "同意すると、控えのPDFがメールで届く。あとからメニューの「設定」でも見られる",
    ],
    note: "身分証・振込先は一度出せば、次の契約書では最初から入っています（直すこともできます）。",
    pageBreak: true,
  },
  {
    id: "staff-howto-notices",
    title: "⑧お知らせを見る",
    image: "/howto/staff-notices.png",
    steps: [
      "会社からのお知らせは、メニューの「お知らせ」とホームに出る（まだ読んでいないものは太字）",
      "タップすると本文や添付の画像・PDFが開き、既読になる",
    ],
  },
  {
    id: "staff-howto-payslips",
    title: "⑨給料明細を見る",
    image: "/howto/staff-payslips.png",
    steps: [
      "右上の丸いアイコン→「給料明細」（または「設定」の「給料明細」）を開く",
      "最初だけ「電子で受け取ることに同意する」を押すと、会社が発行した明細が月ごとに見られる",
      "タップするとPDFが開き、「保存・共有」から保存や印刷ができる。明細が届いたり修正されたりするとお知らせが届く",
    ],
    note: "同意しない場合は、これまで通り会社から受け取ってください。業務委託の方は「支払明細」として届きます。",
  },
];

function isStandaloneOrPhone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.innerWidth < 640
  );
}

export function StaffHowTo() {
  const router = useRouter();
  function printManual() {
    if (isStandaloneOrPhone()) router.push(pdfViewerHref("/howto/staff-manual.pdf"));
    else window.print();
  }
  return (
    <div className="flex flex-col gap-6 print:block">
      <div className="print-hide flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif-jp text-xl font-bold text-primary">使い方</h1>
        <button
          type="button"
          onClick={printManual}
          className="rounded-lg border border-primary px-3 py-1.5 text-xs font-semibold text-primary"
        >
          🖨 印刷・PDFで見る
        </button>
      </div>
      <h1 className="hidden font-serif-jp text-lg font-bold text-primary print:mb-2 print:block">TeeRA 使い方マニュアル（スタッフ用）</h1>
      {SECTIONS.map((s) => (
        <section
          key={s.id}
          id={s.id}
          className={`print-avoid-break rounded-2xl border border-border bg-white/60 p-4 print:mb-3 print:min-h-[84mm] print:rounded-lg print:p-3 ${s.pageBreak ? "print-page-break" : ""}`}
        >
          <h2 className="mb-3 font-serif-jp text-base font-bold text-primary print:mb-1.5">{s.title}</h2>
          <div className="flex gap-4 print:gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.image}
              alt={s.title}
              className="w-[38%] max-w-[180px] shrink-0 self-start rounded-xl border border-border print:aspect-[39/56] print:w-[22%] print:max-w-none print:rounded-md print:object-cover print:object-top"
            />
            <div className="min-w-0 flex-1">
              <ol className="list-decimal space-y-2 pl-5 text-sm print:space-y-1 print:pl-4 print:text-[12.5px] print:leading-snug">
                {s.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {s.note ? <p className="mt-3 text-xs text-muted print:mt-1.5 print:text-[11px] print:leading-snug">{s.note}</p> : null}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
