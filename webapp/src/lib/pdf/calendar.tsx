import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

Font.register({
  family: "Noto Sans JP",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/notosansjp/v53/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf",
      fontWeight: 400,
    },
    {
      src: "https://fonts.gstatic.com/s/notosansjp/v53/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf",
      fontWeight: 700,
    },
  ],
});

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Noto Sans JP", fontSize: 10, color: "#1c2b26" },
  title: { fontSize: 18, fontWeight: 700, color: "#0b3d2e", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#6b7d76", marginBottom: 16 },
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
};

export type CalendarPdfData = {
  companyName: string;
  year: number;
  month: number;
  issuedAt: string;
  shifts: CalendarPdfShift[];
};

function timeLabel(s: CalendarPdfShift) {
  if (s.isUndecided) return "未定";
  if (s.isAllDay) return "終日";
  return `${s.startTime ?? "--:--"}〜${s.endTime ?? "--:--"}`;
}

export function CalendarPdfDocument({ data }: { data: CalendarPdfData }) {
  const byDate = new Map<string, CalendarPdfShift[]>();
  for (const s of data.shifts) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }
  const dates = Array.from(byDate.keys()).sort();

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>シフト表</Text>
        <Text style={styles.subtitle}>
          {data.companyName} ／ 対象月: {data.year}年{data.month}月 ／ 発行日: {data.issuedAt}
        </Text>

        {dates.length === 0 ? <Text style={styles.empty}>この月のシフトはありません。</Text> : null}

        {dates.map((date) => {
          const dow = new Date(date + "T00:00:00Z").getUTCDay();
          const day = Number(date.slice(8, 10));
          return (
            <View key={date} style={styles.dayGroup} wrap={false}>
              <View style={styles.dayHeader}>
                <Text>
                  {data.month}月{day}日（{WEEKDAYS[dow]}）
                </Text>
                <Text>{byDate.get(date)!.length}件</Text>
              </View>
              {byDate.get(date)!.map((s, i) => (
                <View key={i} style={styles.row}>
                  <Text style={styles.colStaff}>{s.staffName}</Text>
                  <Text style={styles.colTime}>{timeLabel(s)}</Text>
                  <Text style={styles.colSource}>{s.clientName ?? "自社"}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </Page>
    </Document>
  );
}
