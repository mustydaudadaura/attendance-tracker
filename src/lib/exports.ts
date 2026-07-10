import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type PdfSection = { label: string; value: string };
export type PdfTable = { headers: string[]; rows: (string | number)[][] };

export function buildPdf(opts: {
  title: string;
  subtitle?: string;
  meta?: PdfSection[];
  tables: PdfTable[];
  footer?: string;
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 40;

  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text("Assalam Tahfizul Qur'an Academy Ltd", 40, y);
  y += 18;
  doc.setFontSize(13).setTextColor(40);
  doc.text(opts.title, 40, y);
  if (opts.subtitle) {
    y += 14;
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(90);
    doc.text(opts.subtitle, 40, y);
  }
  y += 8;
  doc.setDrawColor(200).line(40, y, pageW - 40, y);
  y += 10;

  if (opts.meta && opts.meta.length) {
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(40);
    const colW = (pageW - 80) / 2;
    opts.meta.forEach((m, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 40 + col * colW;
      const yy = y + row * 16;
      doc.setFont("helvetica", "bold").text(`${m.label}:`, x, yy);
      const labelWidth = doc.getTextWidth(`${m.label}: `);
      doc.setFont("helvetica", "normal").text(m.value, x + labelWidth, yy);
    });
    y += Math.ceil(opts.meta.length / 2) * 16 + 6;
  }

  opts.tables.forEach((t) => {
    autoTable(doc, {
      startY: y,
      head: [t.headers],
      body: t.rows.map((r) => r.map((v) => String(v))),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [30, 58, 138], textColor: 255 },
      alternateRowStyles: { fillColor: [246, 248, 251] },
      margin: { left: 40, right: 40 },
    });
    // @ts-expect-error autotable adds lastAutoTable
    y = doc.lastAutoTable.finalY + 16;
  });

  if (opts.footer) {
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(8).setTextColor(120);
      doc.text(opts.footer, 40, doc.internal.pageSize.getHeight() - 20);
      doc.text(`Page ${p} of ${pages}`, pageW - 40, doc.internal.pageSize.getHeight() - 20, { align: "right" });
    }
  }

  return doc;
}

export function savePdf(doc: jsPDF, filename: string) {
  doc.save(filename);
}
