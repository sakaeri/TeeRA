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

export type InvoicePdfData = {
  issuingCompanyName: string;
  clientName: string;
  periodLabel: string;
  dueDate: string | null;
  note: string | null;
  issuedAt: string;
  registered: boolean;
  invoiceRegistrationNumber: string | null;
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
        <Text style={styles.subtitle}>
          {data.clientName} 御中 ／ {data.issuingCompanyName} ／ 対象期間: {data.periodLabel} ／ 発行日:{" "}
          {data.issuedAt}
        </Text>
        <Text style={styles.subtitle}>
          支払期限: {data.dueDate ?? "—"} ／{" "}
          {data.registered
            ? `登録番号: ${data.invoiceRegistrationNumber}`
            : "登録なし（適格請求書発行事業者登録なし）"}
        </Text>

        <View style={styles.section}>
          <View style={styles.headerRow}>
            <Text>スタッフ／内容</Text>
            <Text>時間</Text>
            <Text>単価</Text>
            <Text>税率</Text>
            <Text>金額</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={styles.row}>
              <Text>
                {l.staffName} / {l.description}
              </Text>
              <Text>{l.hours}h</Text>
              <Text>{l.rate}円</Text>
              <Text>{l.taxRatePercent}%</Text>
              <Text>{l.amount}円</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>消費税区分</Text>
          {data.brackets.map((b) => (
            <View key={b.rate} style={styles.row}>
              <Text>{b.rate}%対象</Text>
              <Text>小計 {b.subtotal}円</Text>
              <Text>消費税 {b.tax}円</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text>小計 {data.subtotalAll}円 ／ 消費税合計 {data.taxAll}円</Text>
          <Text>合計金額 {data.total}円</Text>
        </View>

        {data.note ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>備考</Text>
            <Text>{data.note}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
