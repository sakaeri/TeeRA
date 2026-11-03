import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { InvoiceDocument, type InvoicePdfData } from "@/lib/pdf/invoice";
import { CalendarPdfDocument, type CalendarPdfData, type CalendarPdfShift } from "@/lib/pdf/calendar";

// 請求書に付ける実績表（発行時に中身を固定してスナップショットに入れる）
export type InvoiceWorkRecord = { rows: CalendarPdfShift[] };

function workRecordData(data: InvoicePdfData, workRecord: InvoiceWorkRecord): CalendarPdfData {
  const [year, month] = data.periodLabel.split("-").map(Number);
  return {
    title: "実績表",
    companyName: data.issuingCompanyName,
    year,
    month,
    issuedAt: data.issuedAt,
    filterLabel: `依頼主：${data.clientName}`,
    thirdColumn: "task",
    shifts: workRecord.rows,
    note: "※請求書の明細の内訳です（承認済みの業務報告と、キャンセル料が発生した取消）。",
    watermarked: data.watermarked,
  };
}

// 請求書のPDF。実績表があれば2ページ目以降に続けて1つのPDFにする。
export async function renderInvoicePdf(data: InvoicePdfData, workRecord: InvoiceWorkRecord | null) {
  const invoiceBuffer = await renderToBuffer(<InvoiceDocument data={data} />);
  if (!workRecord || workRecord.rows.length === 0) return new Uint8Array(invoiceBuffer);
  const recordBuffer = await renderToBuffer(<CalendarPdfDocument data={workRecordData(data, workRecord)} />);
  return mergePdfs([invoiceBuffer, recordBuffer]);
}

export async function mergePdfs(buffers: (Buffer | Uint8Array)[]) {
  const merged = await PDFDocument.create();
  for (const buffer of buffers) {
    const source = await PDFDocument.load(buffer);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save();
}
