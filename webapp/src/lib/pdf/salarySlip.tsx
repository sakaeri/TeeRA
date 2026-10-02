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
  title: { fontSize: 20, fontWeight: 700, color: "#0b3d2e", marginBottom: 14 },
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
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  recipientBlock: { flexGrow: 1 },
  recipientName: { fontSize: 14, fontWeight: 700, marginBottom: 10 },
  subjectLine: { fontSize: 10, marginBottom: 4 },
  issuerBlock: { alignItems: "flex-end", textAlign: "right" },
  issuerLine: { fontSize: 9, color: "#45534d", marginBottom: 2 },
  metaBlock: { marginTop: 14, flexDirection: "row", gap: 24 },
  metaLine: { fontSize: 9, color: "#45534d" },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: "#0b3d2e", marginBottom: 6 },
  tableHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    backgroundColor: "#0b3d2e",
    paddingHorizontal: 6,
  },
  tableHeaderText: { fontSize: 9, fontWeight: 700, color: "#f4ead0" },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e6e1d3",
  },
  summaryBox: {
    marginTop: 14,
    alignSelf: "flex-end",
    width: 240,
    borderWidth: 1,
    borderColor: "#e6e1d3",
    borderRadius: 4,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e6e1d3",
  },
  summaryRowFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: "#f4ead0",
  },
  summaryLabel: { fontSize: 9, color: "#45534d" },
  summaryLabelFinal: { fontSize: 10, fontWeight: 700, color: "#0b3d2e" },
  summaryValue: { fontSize: 9 },
  summaryValueFinal: { fontSize: 12, fontWeight: 700, color: "#0b3d2e" },
});

export type SalarySlipPdfData = {
  companyName: string;
  companyAddress: string | null;
  companyPhoneNumber: string | null;
  staffName: string;
  targetMonth: string;
  issuedAt: string;
  paymentDay: string | null;
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

        <View style={styles.headerRow}>
          <View style={styles.recipientBlock}>
            <Text style={styles.recipientName}>{data.staffName} 様</Text>
            <Text style={styles.subjectLine}>件名：{data.targetMonth}分 給与</Text>
          </View>
          <View style={styles.issuerBlock}>
            <Text style={styles.issuerLine}>{data.companyName}</Text>
            {data.companyAddress ? <Text style={styles.issuerLine}>{data.companyAddress}</Text> : null}
            {data.companyPhoneNumber ? <Text style={styles.issuerLine}>TEL: {data.companyPhoneNumber}</Text> : null}
          </View>
        </View>

        <View style={styles.metaBlock}>
          <Text style={styles.metaLine}>発行日: {data.issuedAt}</Text>
          <Text style={styles.metaLine}>支払日: {data.paymentDay ?? "—"}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>勤務内訳</Text>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.tableHeaderText}>内容</Text>
            <Text style={styles.tableHeaderText}>数量</Text>
            <Text style={styles.tableHeaderText}>単価</Text>
            <Text style={styles.tableHeaderText}>金額</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={styles.tableRow}>
              <Text>{l.description}</Text>
              <Text>{l.hours}</Text>
              <Text>{l.rate}円</Text>
              <Text>{l.amount}円</Text>
            </View>
          ))}
          {data.paidLeaveDaysUsed > 0 ? (
            <View style={styles.tableRow}>
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
            <View key={d.id} style={styles.tableRow}>
              <Text>{d.label}</Text>
              <Text>{d.amount}円</Text>
            </View>
          ))}
        </View>

        <View style={styles.summaryBox}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>支給合計</Text>
            <Text style={styles.summaryValue}>{data.gross.toLocaleString()}円</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>控除合計</Text>
            <Text style={styles.summaryValue}>{data.totalDeductions.toLocaleString()}円</Text>
          </View>
          <View style={styles.summaryRowFinal}>
            <Text style={styles.summaryLabelFinal}>差引支給額</Text>
            <Text style={styles.summaryValueFinal}>{data.net.toLocaleString()}円</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
