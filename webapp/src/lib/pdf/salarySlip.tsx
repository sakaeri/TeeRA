import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import type { DeductionItem } from "@/lib/domain/payroll";

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
  watermark: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    opacity: 0.06,
  },
  watermarkText: { fontSize: 24, color: "#0b3d2e", margin: 30, transform: "rotate(-30deg)" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#e6e1d3" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#0b3d2e", fontWeight: 700 },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: "#0b3d2e", marginBottom: 6 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, marginTop: 8, borderTopWidth: 2, borderTopColor: "#0b3d2e" },
});

export type SalarySlipPdfData = {
  companyName: string;
  staffName: string;
  targetMonth: string;
  issuedAt: string;
  lines: { description: string; hours: number; rate: number; amount: number }[];
  deductions: DeductionItem[];
  paidLeaveDaysUsed: number;
  paidLeaveDailyRate: number;
  grossFromShifts: number;
  paidLeaveAmount: number;
  gross: number;
  totalDeductions: number;
  net: number;
  watermarked: boolean;
};

export function SalarySlipDocument({ data }: { data: SalarySlipPdfData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {data.watermarked ? (
          <View style={styles.watermark} fixed>
            {Array.from({ length: 13 }).map((_, i) => (
              <Text key={i} style={styles.watermarkText}>
                TeeRA
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.title}>給与明細書</Text>
        <Text style={styles.subtitle}>
          {data.companyName} ／ {data.staffName} 様 ／ 対象月: {data.targetMonth} ／ 発行日: {data.issuedAt}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>勤務内訳</Text>
          <View style={styles.headerRow}>
            <Text>内容</Text>
            <Text>時間</Text>
            <Text>単価</Text>
            <Text>金額</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={styles.row}>
              <Text>{l.description}</Text>
              <Text>{l.hours}h</Text>
              <Text>{l.rate}円</Text>
              <Text>{l.amount}円</Text>
            </View>
          ))}
          {data.paidLeaveDaysUsed > 0 ? (
            <View style={styles.row}>
              <Text>有給休暇 {data.paidLeaveDaysUsed}日</Text>
              <Text>—</Text>
              <Text>{data.paidLeaveDailyRate}円/日</Text>
              <Text>{data.paidLeaveAmount}円</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>控除</Text>
          {data.deductions.map((d) => (
            <View key={d.id} style={styles.row}>
              <Text>{d.label}</Text>
              <Text>{d.amount}円</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text>支給合計 {data.gross}円 ／ 控除合計 {data.totalDeductions}円</Text>
          <Text>差引支給額 {data.net}円</Text>
        </View>
      </Page>
    </Document>
  );
}
