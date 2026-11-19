// 会社名の短縮（カレンダーの狭いマス用）。スタッフ側・会社側のカレンダーで共通。
// 日セルの狭い枠に会社名を出すための短縮 — 「株式会社」等の法人格は前株
// でも後株でも付くうえ、ほとんどの会社名の頭に来るため、単純に先頭を
// 切ると「株式会社◯」ばかりになって見分けが付かない。法人格を先に
// 取り除いて識別に効く部分を優先し、枠に入りきらない分はCSS側で
// （…を付けず、はみ出た分をそのまま切り捨てる形で）省略する。
const CORPORATE_LABELS = [
  "株式会社",
  "有限会社",
  "合同会社",
  "合資会社",
  "合名会社",
  "一般社団法人",
  "一般財団法人",
  "医療法人",
  "社会福祉法人",
  "学校法人",
];

export function shortCompanyName(name: string) {
  let stripped = name;
  for (const label of CORPORATE_LABELS) {
    if (stripped.startsWith(label)) {
      stripped = stripped.slice(label.length);
      break;
    }
    if (stripped.endsWith(label)) {
      stripped = stripped.slice(0, -label.length);
      break;
    }
  }
  // 空白を除いた名前をそのまま出す（マスに入りきらない分は枠で切れる。日付の詳細では全部見える）
  stripped = stripped.replace(/\s+/g, "");
  return stripped || name.replace(/\s+/g, "");
}
