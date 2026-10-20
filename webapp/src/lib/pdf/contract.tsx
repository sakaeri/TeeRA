import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import type { ContractDocument } from "@/lib/contractDocument";

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
  title: { fontSize: 18, fontWeight: 700, color: "#0b3d2e", textAlign: "center", marginBottom: 18 },
  intro: { fontSize: 10, lineHeight: 1.7, marginBottom: 12 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e6e1d3", paddingVertical: 4 },
  rowLabel: { width: 110, color: "#45534d", fontWeight: 700 },
  rowValue: { flex: 1, lineHeight: 1.5 },
  parties: { flexDirection: "row", gap: 16, marginTop: 14 },
  partyBox: { flex: 1, borderWidth: 1, borderColor: "#e6e1d3", borderRadius: 4, padding: 8 },
  partyTitle: { fontSize: 9, color: "#45534d", marginBottom: 4 },
  partyLine: { fontSize: 10, marginBottom: 2 },
  record: { marginTop: 12, borderWidth: 1, borderColor: "#0b3d2e", borderRadius: 4, padding: 10 },
  recordTitle: { fontSize: 11, fontWeight: 700, color: "#0b3d2e", marginBottom: 6 },
  recordLine: { fontSize: 8.5, color: "#1c2b26", marginBottom: 3, lineHeight: 1.4 },
  recordNote: { fontSize: 7.5, color: "#6b7670", marginTop: 4, lineHeight: 1.4 },
  draft: { marginTop: 18, fontSize: 9, color: "#9a3412" },
});

export type ContractConsentRecord = {
  consentedAt: string; // 表示用（JST）
  email: string | null;
  emailVerified: boolean | null;
  ip: string | null;
  userAgent: string | null;
  hash: string | null;
};

export function ContractPdfDocument({
  document,
  consent,
}: {
  document: ContractDocument;
  // 同意前（または同意の記録が無い古い契約）はnull
  consent: ContractConsentRecord | null;
}) {
  return (
    <Document title="雇用契約書">
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>雇用契約書</Text>
        <Text style={styles.intro}>{document.intro}</Text>
        <View>
          {document.rows.map((r, i) => (
            <View key={i} style={styles.row} wrap={false}>
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Text style={styles.rowValue}>{r.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.parties} wrap={false}>
          <View style={styles.partyBox}>
            <Text style={styles.partyTitle}>甲</Text>
            <Text style={styles.partyLine}>{document.companyName}</Text>
            {document.companyAddress ? <Text style={styles.partyLine}>{document.companyAddress}</Text> : null}
          </View>
          <View style={styles.partyBox}>
            <Text style={styles.partyTitle}>乙</Text>
            <Text style={styles.partyLine}>{document.partyName}</Text>
            {document.partyAddress ? <Text style={styles.partyLine}>{document.partyAddress}</Text> : null}
            {document.partyPhoneNumber ? <Text style={styles.partyLine}>{document.partyPhoneNumber}</Text> : null}
          </View>
        </View>

        {consent ? (
          <View style={styles.record} wrap={false}>
            <Text style={styles.recordTitle}>同意の記録</Text>
            <Text style={styles.recordLine}>同意日時：{consent.consentedAt}</Text>
            {consent.email ? (
              <Text style={styles.recordLine}>
                同意したアカウント：{consent.email}
                {consent.emailVerified ? "（メールアドレス確認済み）" : ""}
              </Text>
            ) : null}
            {consent.ip ? <Text style={styles.recordLine}>接続元IPアドレス：{consent.ip}</Text> : null}
            {consent.userAgent ? <Text style={styles.recordLine}>端末・ブラウザ：{consent.userAgent}</Text> : null}
            {consent.hash ? <Text style={styles.recordLine}>文書ハッシュ（SHA-256）：{consent.hash}</Text> : null}
            <Text style={styles.recordNote}>
              乙はTeeRA上で本契約書の全文を確認し、氏名・住所・電話番号を入力して同意しました。文書ハッシュは同意した時点の契約内容と同意日時から計算した値で、内容が1文字でも変わると一致しなくなります。
            </Text>
          </View>
        ) : (
          <Text style={styles.draft}>※この契約書には、アプリ上での同意の記録がありません。</Text>
        )}
      </Page>
    </Document>
  );
}
