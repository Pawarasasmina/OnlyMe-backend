const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 54;

const pdfText = (value) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/gu, "")
  .replace(/[^\x20-\x7e\xa0-\xff]/gu, "?")
  .replace(/([\\()])/gu, "\\$1");

const wrap = (value, width = 78) => {
  const words = String(value || "").replace(/\s+/gu, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
};

function contentLines(snapshot = {}) {
  const metadata = snapshot.metadata || {};
  const lines = [
    { text: metadata.title || "Untitled Seen", size: 24, bold: true, gap: 10 },
    { text: metadata.summary || metadata.description || "", size: 11, color: ".28 .36 .46", gap: 18 },
  ];
  (snapshot.chapters || []).forEach((chapter, index) => {
    lines.push({ text: `Chapter ${index + 1}: ${chapter.title || `Chapter ${index + 1}`}`, size: 17, bold: true, gap: 10, pageBreakBefore: index > 0 });
    (chapter.blocks || []).sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).forEach((block) => {
      const type = String(block.type || "").toUpperCase();
      if (block.text) lines.push({ text: block.text, size: type === "HIGHLIGHT" ? 13 : 11, bold: ["KEY_POINT", "HIGHLIGHT"].includes(type), gap: 8 });
      if (type === "POLL") {
        const question = block.metadata?.question || "Poll";
        lines.push({ text: question, size: 11, bold: true, gap: 4 });
        (block.metadata?.options || []).forEach((option) => lines.push({ text: `- ${option.text || option}`, size: 10, gap: 3 }));
      }
      if (block.url) lines.push({ text: `${block.label || "Link"}: ${block.url}`, size: 10, color: ".10 .38 .67", gap: 7 });
      if (block.media?.secureUrl) {
        const mediaLabel = type ? type.charAt(0) + type.slice(1).toLowerCase() : "Media";
        lines.push({ text: `[${mediaLabel}] ${block.metadata?.caption || block.metadata?.alt || "Available in the online Seen"}`, size: 9, color: ".35 .39 .44", gap: 7 });
      }
    });
    lines.push({ text: "", size: 8, gap: 8 });
  });
  return lines;
}

function paginate(lines, watermark) {
  const pages = [];
  let page = [];
  let y = PAGE_HEIGHT - MARGIN - 30;
  const pushPage = () => { if (page.length) pages.push(page); page = []; y = PAGE_HEIGHT - MARGIN - 30; };
  for (const item of lines) {
    if (item.pageBreakBefore && page.length) pushPage();
    const size = item.size || 11;
    const wrapped = wrap(item.text, Math.max(30, Math.floor(92 * (11 / size))));
    for (const text of wrapped) {
      const height = size * 1.38;
      if (y - height < MARGIN + 32) pushPage();
      page.push({ ...item, text, y });
      y -= height;
    }
    y -= item.gap || 0;
  }
  pushPage();
  return pages.map((items, index) => ({ items, footer: `${watermark}  |  Page ${index + 1} of ${pages.length}` }));
}

function streamForPage(page) {
  const commands = ["q", "1 1 1 rg", `0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} re f`, "Q"];
  page.items.forEach((line) => {
    commands.push("BT", `/${line.bold ? "F2" : "F1"} ${line.size || 11} Tf`, `${line.color || ".08 .10 .13"} rg`, `1 0 0 1 ${MARGIN} ${line.y.toFixed(2)} Tm`, `(${pdfText(line.text)}) Tj`, "ET");
  });
  commands.push("BT", "/F1 8 Tf", ".48 .52 .58 rg", `1 0 0 1 ${MARGIN} 28 Tm`, `(${pdfText(page.footer)}) Tj`, "ET");
  return commands.join("\n");
}

export function buildSeenPdf({ publication, viewer }) {
  const snapshot = publication.publishedSnapshot;
  const viewerName = viewer?.username ? `@${viewer.username}` : viewer?.name || String(viewer?._id || "viewer");
  const watermark = `@seen - Personal copy for ${viewerName}`;
  const pages = paginate(contentLines(snapshot), watermark);
  const objects = [null];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const kids = [];
  pages.forEach((page) => {
    const pageId = objects.length;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream = streamForPage(page);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(pdf, "latin1");
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

