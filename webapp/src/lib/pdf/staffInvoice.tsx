import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
// フォントの登録（Noto Sans JP）は請求書のPDFと共通
import "@/lib/pdf/invoice";

// 業務委託のスタッフから会社へ出す請求書のPDF（staffInvoices.ts）
export type StaffInvoicePdfData = {
  companyName: string;
  targetMonth: string;
  submittedAt: string; // YYYY-MM-DD
  statusLabel: string | null; // 「確認中」「差し戻し」など。承認済みならnull
  issuerName: string;
  issuerAddress: string | null;
  registrationNumber: string | null;
  lines: { description: string; hours: number; rate: number; amount: number; isDaily: boolean }[];
  expenses: { label: string; quantity: number; unitPrice: number; amount: number }[];
  workSubtotal: number;
  taxExclusive: boolean;
  taxAmount: number;
  withholding: boolean;
  withholdingAmount: number;
  expensesTotal: number;
  total: number;
  bank: { bankName: string | null; branchName: string | null; accountType: string | null; accountNumber: string | null; accountHolderName: string | null };
  note: string | null;
};

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Noto Sans JP", fontSize: 10, color: "#1c2b26" },
  title: { fontSize: 20, fontWeight: 700, color: "#0b3d2e", marginBottom: 14, textAlign: "center" },
  status: { fontSize: 9, color: "#a33", textAlign: "center", marginBottom: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  recipientName: { fontSize: 14, fontWeight: 700, marginBottom: 8 },
  line: { fontSize: 9, color: "#45534d", marginBottom: 2 },
  issuerBlock: { alignItems: "flex-end", textAlign: "right" },
  issuerName: { fontSize: 12, fontWeight: 700, color: "#0b3d2e", marginBottom: 3 },
  totalBox: {
    marginTop: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: "#0b3d2e",
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { fontSize: 11, color: "#45534d" },
  totalAmount: { fontSize: 20, fontWeight: 700, color: "#0b3d2e" },
  th: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, backgroundColor: "#0b3d2e" },
  thText: { fontSize: 9, fontWeight: 700, color: "#f4ead0" },
  tr: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: "#e6e1d3" },
  colDesc: { flexGrow: 1, flexShrink: 1 },
  colQty: { width: 56, textAlign: "right" },
  colRate: { width: 64, textAlign: "right" },
  colAmount: { width: 74, textAlign: "right" },
  sumRow: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 3, paddingHorizontal: 6 },
  sumLabel: { width: 140, textAlign: "right", color: "#45534d" },
  sumValue: { width: 90, textAlign: "right" },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 10, fontWeight: 700, color: "#0b3d2e", marginBottom: 4 },
});

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

export function StaffInvoiceDocument({ data }: { data: StaffInvoicePdfData }) {
  const [y, m] = data.targetMonth.split("-").map(Number);
  const bankLine = data.bank.bankName
    ? `${data.bank.bankName} ${data.bank.branchName ?? ""} ${data.bank.accountType ?? ""} ${data.bank.accountNumber ?? ""} ${data.bank.accountHolderName ?? ""}`
    : null;
  return (
    <Document title={`請求書 ${y}年${m}月分`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>請求書</Text>
        {data.statusLabel ? <Text style={styles.status}>（{data.statusLabel}）</Text> : null}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.recipientName}>{data.companyName} 御中</Text>
            <Text style={styles.line}>件名：{y}年{m}月分 業務委託料</Text>
            <Text style={styles.line}>請求日：{data.submittedAt}</Text>
          </View>
          <View style={styles.issuerBlock}>
            <Text style={styles.issuerName}>{data.issuerName}</Text>
            {data.issuerAddress ? <Text style={styles.line}>{data.issuerAddress}</Text> : null}
            {data.registrationNumber ? <Text style={styles.line}>登録番号：{data.registrationNumber}</Text> : null}
          </View>
        </View>

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>ご請求金額</Text>
          <Text style={styles.totalAmount}>{yen(data.total)}</Text>
        </View>

        <View style={styles.th}>
          <Text style={[styles.thText, styles.colDesc]}>内容</Text>
          <Text style={[styles.thText, styles.colQty]}>数量</Text>
          <Text style={[styles.thText, styles.colRate]}>単価</Text>
          <Text style={[styles.thText, styles.colAmount]}>金額</Text>
        </View>
        {data.lines.map((l, i) => (
          <View key={i} style={styles.tr} wrap={false}>
            <Text style={styles.colDesc}>{l.description}</Text>
            <Text style={styles.colQty}>{l.isDaily ? `${l.hours}日` : `${Math.round(l.hours * 100) / 100}時間`}</Text>
            <Text style={styles.colRate}>{yen(l.rate)}</Text>
            <Text style={styles.colAmount}>{yen(l.amount)}</Text>
          </View>
        ))}
        {data.expenses.map((e, i) => (
          <View key={`e${i}`} style={styles.tr} wrap={false}>
            <Text style={styles.colDesc}>{e.label}</Text>
            <Text style={styles.colQty}>{e.quantity}</Text>
            <Text style={styles.colRate}>{yen(e.unitPrice)}</Text>
            <Text style={styles.colAmount}>{yen(e.amount)}</Text>
          </View>
        ))}

        <View style={{ marginTop: 6 }}>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>報酬{data.taxExclusive ? "（税抜）" : "（税込）"}</Text>
            <Text style={styles.sumValue}>{yen(data.workSubtotal)}</Text>
          </View>
          {data.taxExclusive ? (
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>消費税（10%）</Text>
              <Text style={styles.sumValue}>{yen(data.taxAmount)}</Text>
            </View>
          ) : null}
          {data.withholding ? (
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>源泉徴収税</Text>
              <Text style={styles.sumValue}>−{yen(data.withholdingAmount)}</Text>
            </View>
          ) : null}
          {data.expensesTotal > 0 ? (
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>その他の項目</Text>
              <Text style={styles.sumValue}>{yen(data.expensesTotal)}</Text>
            </View>
          ) : null}
          <View style={[styles.sumRow, { borderTopWidth: 1, borderTopColor: "#0b3d2e", marginTop: 2 }]}>
            <Text style={[styles.sumLabel, { fontWeight: 700, color: "#0b3d2e" }]}>ご請求金額</Text>
            <Text style={[styles.sumValue, { fontWeight: 700 }]}>{yen(data.total)}</Text>
          </View>
        </View>

        {bankLine ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>お振込先</Text>
            <Text>{bankLine}</Text>
          </View>
        ) : null}
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
