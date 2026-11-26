import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { shiftListTimeLabel } from "@/lib/shiftListTimeLabel";

Font.register({
  family: "Noto Sans JP",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/notosansjp/v53/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf",
      fontWeight: 400,
    },
    {
      src: "https://fonts.gstatic.com/s/notosansjp/v53/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk75s.ttf",
      fontWeight: 700,
    },
  ],
});

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Noto Sans JP", fontSize: 10, color: "#1c2b26" },
  watermark: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row", flexWrap: "wrap", opacity: 0.14 },
  watermarkText: { fontSize: 22, color: "#0b3d2e", marginVertical: 34, marginHorizontal: 18, transform: "rotate(-30deg)" },
  title: { fontSize: 18, fontWeight: 700, color: "#0b3d2e", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#6b7d76", marginBottom: 8 },
  summary: { fontSize: 11, fontWeight: 700, color: "#0b3d2e", marginBottom: 14 },
  dayGroup: { marginBottom: 10 },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: "#e9ece3",
    fontWeight: 700,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e6e1d3",
  },
  colStaff: { width: "40%" },
  colTime: { width: "30%" },
  colSource: { width: "30%" },
  empty: { color: "#6b7d76", paddingVertical: 20, textAlign: "center" },
});

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export type CalendarPdfShift = {
  date: string; // YYYY-MM-DD
  staffName: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  clientName?: string | null;
  taskName?: string | null;
  // 業務報告の内容（出勤・欠勤・取消と、出勤の実際の時間）
  outcome?: string | null;
  reportedTimeLabel?: string | null;
  // 時間欄にそのまま出す文字（実績表のキャンセル料の行など）
  timeOverride?: string | null;
  // 実績表の実働（分）。合計の実働時間に使う
  workedMinutes?: number | null;
};

export type CalendarPdfData = {
  companyName: string;
  year: number;
  month: number;
  // 締め日が末日でない時の対象期間（例：「10/21〜11/20」）と、その初日。あれば「対象月」の代わりに出す
  periodRangeLabel?: string | null;
  periodStart?: string | null;
  issuedAt: string;
  filterLabel?: string | null;
  title?: string;
  shifts: CalendarPdfShift[];
  // 依頼主/派遣会社で絞り込んでいる時は、全行が同じ勤務先になり冗長な
  // ため、代わりに業務内容を出す方が参考になる（chat相談で決定）。
  thirdColumn?: "workplace" | "task";
  // 一覧の下に出す注記
  note?: string;
  // 請求書の見本に付けるときは、実績表にも「見本」の透かしを入れる
  watermarked?: boolean;
};

function timeLabel(s: CalendarPdfShift, todayStr: string) {
  if (s.timeOverride) return s.timeOverride;
  return shiftListTimeLabel({ ...s, todayStr });
}

// 一覧の上に出す合計（件数・人数。実績表は出勤・取消の内訳と実働時間も）
function summaryLabel(data: CalendarPdfData) {
  const count = data.shifts.length;
  const people = new Set(data.shifts.map((s) => s.staffName)).size;
  const base = `合計 ${count}件・${people}人`;
  if (data.title !== "実績表") return base;
  const cancelled = data.shifts.filter((s) => s.timeOverride).length;
  const minutes = data.shifts.reduce((sum, s) => sum + (s.workedMinutes ?? 0), 0);
  const hours = `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ""}`;
  return `${base}（出勤 ${count - cancelled}件・実働 ${hours}${cancelled ? `／取消（キャンセル料あり）${cancelled}件` : ""}）`;
}

export function CalendarPdfDocument({ data }: { data: CalendarPdfData }) {
  const byDate = new Map<string, CalendarPdfShift[]>();
  for (const s of data.shifts) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }
  const dates = Array.from(byDate.keys()).sort();
  // 対象月より前の日付が入っているか（請求書に前の月の未請求分を入れた時）
  // 締め日が末日でない時は対象期間の初日で見る（20日締めの10/21〜10/31は「前の月」ではない）
  const monthPrefix = `${data.year}-${String(data.month).padStart(2, "0")}`;
  const hasEarlierMonths = data.periodStart ? dates.some((d) => d < data.periodStart!) : dates.some((d) => d.slice(0, 7) < monthPrefix);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {data.watermarked ? (
          <View style={styles.watermark} fixed>
            {Array.from({ length: 30 }).map((_, i) => (
              <Text key={i} style={styles.watermarkText}>
                ーTeeRA見本ー
              </Text>
            ))}
          </View>
        ) : null}
        <Text style={styles.title}>{data.title ?? "シフト表"}</Text>
        <Text style={styles.subtitle}>
          {data.companyName} ／ {data.periodRangeLabel ? `対象期間: ${data.periodRangeLabel}` : `対象月: ${data.year}年${data.month}月`}
          {hasEarlierMonths ? "（前の月以前の未請求分を含む）" : ""} ／ 発行日: {data.issuedAt}
          {data.filterLabel ? ` ／ 絞り込み: ${data.filterLabel}` : ""}
        </Text>
        {data.shifts.length > 0 ? <Text style={styles.summary}>{summaryLabel(data)}</Text> : null}

        {dates.length === 0 ? (
          <Text style={styles.empty}>{data.title === "実績表" ? "この月の実績はありません。" : "この月のシフトはありません。"}</Text>
        ) : null}

        {dates.map((date) => {
          const dow = new Date(date + "T00:00:00Z").getUTCDay();
          // 月は日付そのものから出す（請求書の実績表には前の月の未請求分も入るため、対象月で書くと日付がずれる）
          const monthOfDate = Number(date.slice(5, 7));
          const day = Number(date.slice(8, 10));
          return (
            <View key={date} style={styles.dayGroup} wrap={false}>
              <View style={styles.dayHeader}>
                <Text>
                  {monthOfDate}月{day}日（{WEEKDAYS[dow]}）
                </Text>
                <Text>{byDate.get(date)!.length}件</Text>
              </View>
              {byDate.get(date)!.map((s, i) => (
                <View key={i} style={styles.row}>
                  <Text style={styles.colStaff}>{s.staffName}</Text>
                  <Text style={styles.colTime}>{timeLabel(s, data.issuedAt)}</Text>
                  <Text style={styles.colSource}>
                    {data.thirdColumn === "task" ? (s.taskName ?? "―") : (s.clientName ?? "自社")}
                  </Text>
                </View>
              ))}
            </View>
          );
        })}
        {data.note ? <Text style={styles.empty}>{data.note}</Text> : null}
      </Page>
    </Document>
  );
}
