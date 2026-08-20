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
  card: {
    marginBottom: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "#e6e1d3",
    borderRadius: 4,
  },
  itemName: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 70, color: "#6b7d76" },
  empty: { color: "#6b7d76", paddingVertical: 20, textAlign: "center" },
});

export type PendingShipmentPdfRow = {
  itemName: string;
  staffName: string;
  createdAt: string;
  shippingAddress: string;
  shippingPhone: string;
};

export type PendingShipmentPdfData = {
  companyName: string;
  issuedAt: string;
  rows: PendingShipmentPdfRow[];
};

export function PendingShipmentPdfDocument({ data }: { data: PendingShipmentPdfData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>発送待ち一覧</Text>
        <Text style={styles.subtitle}>
          {data.companyName} ／ 発行日: {data.issuedAt} ／ {data.rows.length}件
        </Text>

        {data.rows.length === 0 ? <Text style={styles.empty}>発送待ちの注文はありません。</Text> : null}

        {data.rows.map((r, i) => (
          <View key={i} style={styles.card} wrap={false}>
            <Text style={styles.itemName}>{r.itemName}</Text>
            <View style={styles.row}>
              <Text style={styles.label}>注文者</Text>
              <Text>{r.staffName}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>注文日</Text>
              <Text>{r.createdAt}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>発送先住所</Text>
              <Text>{r.shippingAddress || "未登録"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>電話番号</Text>
              <Text>{r.shippingPhone || "未登録"}</Text>
            </View>
          </View>
        ))}
      </Page>
    </Document>
  );
}
