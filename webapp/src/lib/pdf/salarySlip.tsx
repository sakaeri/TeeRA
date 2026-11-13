import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { formatQuantity } from "@/lib/quantityUnit";
import type { DeductionItem } from "@/lib/domain/payroll";

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
    // 見本だと分かるように、以前より少し濃く出す（このまま使われないように）
    opacity: 0.14,
  },
  watermarkText: { fontSize: 22, color: "#0b3d2e", marginVertical: 34, marginHorizontal: 18, transform: "rotate(-30deg)" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  recipientBlock: { flexGrow: 1 },
  recipientName: { fontSize: 14, fontWeight: 700, marginBottom: 10 },
  subjectLine: { fontSize: 10, marginBottom: 4 },
  issuerBlock: { alignItems: "flex-end", textAlign: "right" },
  issuerName: { fontSize: 12, fontWeight: 700, color: "#0b3d2e", marginBottom: 3 },
  issuerLine: { fontSize: 9, color: "#45534d", marginBottom: 2 },
  metaBlock: { marginTop: 14, flexDirection: "row", gap: 24 },
  metaLine: { fontSize: 9, color: "#45534d" },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: "#0b3d2e", marginBottom: 6 },
  tableHeaderRow: {
    flexDirection: "row",
    paddingVertical: 5,
    backgroundColor: "#0b3d2e",
    paddingHorizontal: 6,
  },
  tableHeaderText: { fontSize: 9, fontWeight: 700, color: "#f4ead0" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e6e1d3",
  },
  tableColDescription: { flexGrow: 1, textAlign: "left" },
  tableColQty: { width: 52, textAlign: "right" },
  tableColRate: { width: 65, textAlign: "right" },
  tableColAmount: { width: 70, textAlign: "right" },
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
  noteBodyCell: { paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#e6e1d3" },
  noteText: { fontSize: 9 },
});

export type SalarySlipPdfData = {
  companyName: string;
  companyAddress: string | null;
  companyPhoneNumber: string | null;
  staffName: string;
  targetMonth: string;
  // 締め日が末日でない会社の対象期間（例："10/21〜11/20"）。末日締めならnull
  periodRangeLabel?: string | null;
  issuedAt: string;
  paymentDay: string | null;
  note: string | null;
  isContractor: boolean;
  lines: { description: string; hours: number; rate: number; amount: number; unit?: string | null }[];
  deductions: DeductionItem[];
  paidLeaveDaysUsed: number;
  paidLeaveDailyRate: number;
  paidLeaveConfigured: boolean;
  grossFromShifts: number;
  paidLeaveAmount: number;
  gross: number;
  totalDeductions: number;
  net: number;
  watermarked: boolean;
};

// "2026-11-25" → "2026年11月25日"。昔の手入力（「翌月25日」など）はそのまま
function formatPaymentDay(paymentDay: string | null) {
  const m = paymentDay?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
  return paymentDay || "—";
}

export function SalarySlipDocument({ data }: { data: SalarySlipPdfData }) {
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

        <Text style={styles.title}>{data.isContractor ? "支払明細書" : "給与明細書"}</Text>

        <View style={styles.headerRow}>
          <View style={styles.recipientBlock}>
            <Text style={styles.recipientName}>{data.staffName} 様</Text>
            <Text style={styles.subjectLine}>
              件名：{data.targetMonth}分 {data.isContractor ? "業務委託料" : "給与"}
            </Text>
            {data.periodRangeLabel ? <Text style={styles.subjectLine}>対象期間：{data.periodRangeLabel}</Text> : null}
          </View>
          <View style={styles.issuerBlock}>
            <Text style={styles.issuerName}>{data.companyName}</Text>
            {data.companyAddress ? <Text style={styles.issuerLine}>{data.companyAddress}</Text> : null}
            {data.companyPhoneNumber ? <Text style={styles.issuerLine}>TEL: {data.companyPhoneNumber}</Text> : null}
          </View>
        </View>

        <View style={styles.metaBlock}>
          <Text style={styles.metaLine}>発行日: {data.issuedAt}</Text>
          <Text style={styles.metaLine}>支払日: {formatPaymentDay(data.paymentDay)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{data.isContractor ? "業務内訳" : "勤務内訳"}</Text>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderText, styles.tableColDescription]}>内容</Text>
            <Text style={[styles.tableHeaderText, styles.tableColQty]}>数量</Text>
            <Text style={[styles.tableHeaderText, styles.tableColRate]}>単価</Text>
            <Text style={[styles.tableHeaderText, styles.tableColAmount]}>金額</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.tableColDescription}>{l.description}</Text>
              <Text style={styles.tableColQty}>{formatQuantity(l.hours, l.unit)}</Text>
              <Text style={styles.tableColRate}>{l.rate.toLocaleString()}円</Text>
              <Text style={styles.tableColAmount}>{l.amount.toLocaleString()}円</Text>
            </View>
          ))}
          {data.paidLeaveDaysUsed > 0 || data.paidLeaveConfigured ? (
            <View style={styles.tableRow}>
              <Text style={styles.tableColDescription}>有給休暇 {data.paidLeaveDaysUsed}日</Text>
              <Text style={styles.tableColQty}>—</Text>
              <Text style={styles.tableColRate}>{data.paidLeaveDailyRate}円/日</Text>
              <Text style={styles.tableColAmount}>{data.paidLeaveAmount}円</Text>
            </View>
          ) : null}
        </View>

        {/* 金額が0円の控除は載せない（業務委託の社会保険料など、対象外の項目が並ばないように） */}
        {data.deductions.some((d) => d.amount !== 0) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>控除</Text>
            {data.deductions
              .filter((d) => d.amount !== 0)
              .map((d) => (
                <View key={d.id} style={styles.tableRow}>
                  <Text style={styles.tableColDescription}>{d.label}</Text>
                  <Text style={styles.tableColAmount}>{d.amount.toLocaleString()}円</Text>
                </View>
              ))}
          </View>
        ) : null}

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

        {data.note ? (
          <View style={styles.section}>
            <View style={styles.tableHeaderRow}>
              <Text style={styles.tableHeaderText}>備考</Text>
            </View>
            <View style={styles.noteBodyCell}>
              <Text style={styles.noteText}>{data.note}</Text>
            </View>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
