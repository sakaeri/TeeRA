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
  issuerName: { fontSize: 12, fontWeight: 700, color: "#0b3d2e", marginBottom: 3 },
  issuerLine: { fontSize: 9, color: "#45534d", marginBottom: 2 },
  metaBlock: { marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 24 },
  metaLine: { fontSize: 9, color: "#45534d" },
  totalBox: {
    marginTop: 18,
    marginBottom: 18,
    borderWidth: 1.5,
    borderColor: "#0b3d2e",
    borderRadius: 4,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalBoxLabel: { fontSize: 11, color: "#45534d" },
  totalBoxAmount: { fontSize: 22, fontWeight: 700, color: "#0b3d2e" },
  section: { marginTop: 16 },
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
  tableColQty: { width: 36, textAlign: "right" },
  tableColRate: { width: 64, textAlign: "right" },
  tableColTax: { width: 42, textAlign: "right" },
  tableColAmount: { width: 70, textAlign: "right" },
  summaryBox: {
    marginTop: 14,
    alignSelf: "flex-end",
    width: 260,
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
  infoRow: { flexDirection: "row" },
  infoLabelCell: { width: 140, backgroundColor: "#0b3d2e", paddingVertical: 6, paddingHorizontal: 8, justifyContent: "center" },
  infoLabelText: { fontSize: 9, fontWeight: 700, color: "#f4ead0" },
  infoValueCell: {
    flexGrow: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e6e1d3",
    justifyContent: "center",
  },
  infoValueText: { fontSize: 9 },
  infoBodyCell: { paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#e6e1d3" },
});

export type InvoicePdfData = {
  issuingCompanyName: string;
  issuingCompanyAddress: string | null;
  issuingCompanyPhoneNumber: string | null;
  clientName: string;
  periodLabel: string;
  dueDate: string | null;
  note: string | null;
  issuedAt: string;
  registered: boolean;
  invoiceRegistrationNumber: string | null;
  bankName: string | null;
  branchName: string | null;
  accountType: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
  lines: { staffName: string; description: string; hours: number; rate: number; amount: number; taxRatePercent: number }[];
  brackets: { rate: number; subtotal: number; tax: number }[];
  subtotalAll: number;
  taxAll: number;
  total: number;
  watermarked: boolean;
};

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
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

        <Text style={styles.title}>請求書</Text>

        <View style={styles.headerRow}>
          <View style={styles.recipientBlock}>
            <Text style={styles.recipientName}>{data.clientName} 御中</Text>
            <Text style={styles.subjectLine}>件名：{data.periodLabel}分 ご請求</Text>
          </View>
          <View style={styles.issuerBlock}>
            <Text style={styles.issuerName}>{data.issuingCompanyName}</Text>
            {data.issuingCompanyAddress ? <Text style={styles.issuerLine}>{data.issuingCompanyAddress}</Text> : null}
            {data.issuingCompanyPhoneNumber ? (
              <Text style={styles.issuerLine}>TEL: {data.issuingCompanyPhoneNumber}</Text>
            ) : null}
            <Text style={styles.issuerLine}>
              {data.registered ? `登録番号: ${data.invoiceRegistrationNumber}` : "登録なし（適格請求書発行事業者登録なし）"}
            </Text>
          </View>
        </View>

        <View style={styles.metaBlock}>
          <Text style={styles.metaLine}>発行日: {data.issuedAt}</Text>
          <Text style={styles.metaLine}>支払期限: {data.dueDate ?? "—"}</Text>
        </View>

        <View style={styles.totalBox}>
          <Text style={styles.totalBoxLabel}>ご請求金額（税込）</Text>
          <Text style={styles.totalBoxAmount}>{data.total.toLocaleString()}円</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderText, styles.tableColDescription]}>内容</Text>
            <Text style={[styles.tableHeaderText, styles.tableColQty]}>数量</Text>
            <Text style={[styles.tableHeaderText, styles.tableColRate]}>単価</Text>
            <Text style={[styles.tableHeaderText, styles.tableColTax]}>税率</Text>
            <Text style={[styles.tableHeaderText, styles.tableColAmount]}>金額</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.tableColDescription}>
                {l.staffName ? `${l.staffName} / ` : ""}
                {l.description}
              </Text>
              <Text style={styles.tableColQty}>{l.hours}</Text>
              <Text style={styles.tableColRate}>{l.rate}円</Text>
              <Text style={styles.tableColTax}>{l.taxRatePercent === 0 ? "なし" : `${l.taxRatePercent}%`}</Text>
              <Text style={styles.tableColAmount}>{l.amount}円</Text>
            </View>
          ))}
        </View>

        <View style={styles.summaryBox}>
          {data.brackets.map((b) => (
            <View key={b.rate} style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                {b.rate === 0 ? "対象外" : `${b.rate}%対象`} 小計 {b.subtotal.toLocaleString()}円
              </Text>
              <Text style={styles.summaryValue}>消費税 {b.tax.toLocaleString()}円</Text>
            </View>
          ))}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>小計</Text>
            <Text style={styles.summaryValue}>{data.subtotalAll.toLocaleString()}円</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>消費税合計</Text>
            <Text style={styles.summaryValue}>{data.taxAll.toLocaleString()}円</Text>
          </View>
          <View style={styles.summaryRowFinal}>
            <Text style={styles.summaryLabelFinal}>合計金額</Text>
            <Text style={styles.summaryValueFinal}>{data.total.toLocaleString()}円</Text>
          </View>
        </View>

        {data.bankName || data.accountNumber || data.accountHolderName ? (
          <View style={styles.section}>
            <View style={styles.tableHeaderRow}>
              <Text style={styles.tableHeaderText}>お振込先</Text>
            </View>
            {data.bankName || data.branchName ? (
              <View style={styles.infoRow}>
                <View style={styles.infoLabelCell}>
                  <Text style={styles.infoLabelText}>金融機関・支店名</Text>
                </View>
                <View style={styles.infoValueCell}>
                  <Text style={styles.infoValueText}>{[data.bankName, data.branchName].filter(Boolean).join(" ")}</Text>
                </View>
              </View>
            ) : null}
            {data.accountNumber ? (
              <View style={styles.infoRow}>
                <View style={styles.infoLabelCell}>
                  <Text style={styles.infoLabelText}>口座番号</Text>
                </View>
                <View style={styles.infoValueCell}>
                  <Text style={styles.infoValueText}>{[data.accountType, data.accountNumber].filter(Boolean).join(" ")}</Text>
                </View>
              </View>
            ) : null}
            {data.accountHolderName ? (
              <View style={styles.infoRow}>
                <View style={styles.infoLabelCell}>
                  <Text style={styles.infoLabelText}>口座名義</Text>
                </View>
                <View style={styles.infoValueCell}>
                  <Text style={styles.infoValueText}>{data.accountHolderName}</Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {data.note ? (
          <View style={styles.section}>
            <View style={styles.tableHeaderRow}>
              <Text style={styles.tableHeaderText}>備考</Text>
            </View>
            <View style={styles.infoBodyCell}>
              <Text style={styles.infoValueText}>{data.note}</Text>
            </View>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
