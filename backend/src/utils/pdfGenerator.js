function normalizePdfText(text = "") {
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x0A\x0D\x20-\x7E]/g, "");
}

function escapePdfText(text = "") {
  return normalizePdfText(text)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function stripInlineMarkdown(text = "") {
  return normalizePdfText(text)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1");
}

function wrapText(text = "", maxLineLength = 88) {
  const lines = [];

  for (const paragraph of String(text).split(/\r?\n/)) {
    const trimmed = paragraph.trim();

    if (!trimmed) {
      lines.push("");
      continue;
    }

    const words = trimmed.split(/\s+/);
    let current = "";

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxLineLength) {
        if (current) {
          lines.push(current);
        }
        current = word;
      } else {
        current = next;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

function buildCenteredWordContent(text = "") {
  const safe = escapePdfText(String(text || "").trim() || "Document");
  return [
    "BT",
    "/F2 36 Tf",
    "190 420 Td",
    `(${safe}) Tj`,
    "ET",
  ].join("\n");
}

function parseMarkdownBlocks(answer = "") {
  const blocks = [];
  const lines = normalizePdfText(answer).split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      blocks.push({ type: "spacer", height: 10 });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push({
        type: "heading",
        text: stripInlineMarkdown(headingMatch[2]),
        level,
      });
      continue;
    }

    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      blocks.push({
        type: "bullet",
        prefix: `${numberedMatch[1]}.`,
        text: stripInlineMarkdown(numberedMatch[2]),
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      blocks.push({
        type: "bullet",
        prefix: "-",
        text: stripInlineMarkdown(bulletMatch[1]),
      });
      continue;
    }

    blocks.push({
      type: "paragraph",
      text: stripInlineMarkdown(trimmed),
    });
  }

  return blocks;
}

function buildLayoutItems({ title, question, answer }) {
  const items = [
    {
      text: normalizePdfText(title || "AI Tutor Answer"),
      x: 52,
      font: "F2",
      size: 22,
      leading: 28,
    },
    { spacer: 14 },
  ];

  if (question?.trim()) {
    items.push({
      text: `Question: ${stripInlineMarkdown(question)}`,
      x: 52,
      font: "F2",
      size: 12,
      leading: 18,
      wrap: 78,
    });
    items.push({ spacer: 10 });
  }

  const blocks = parseMarkdownBlocks(answer || "No answer was available.");

  for (const block of blocks) {
    if (block.type === "spacer") {
      items.push({ spacer: block.height });
      continue;
    }

    if (block.type === "heading") {
      items.push({
        text: block.text,
        x: 52,
        font: "F2",
        size: block.level === 1 ? 18 : block.level === 2 ? 16 : 14,
        leading: block.level === 1 ? 24 : 20,
        wrap: 64,
      });
      items.push({ spacer: 4 });
      continue;
    }

    if (block.type === "bullet") {
      const wrapped = wrapText(block.text, 78);
      wrapped.forEach((line, index) => {
        items.push({
          text: index === 0 ? `${block.prefix} ${line}` : `   ${line}`,
          x: 60,
          font: "F1",
          size: 12,
          leading: 18,
        });
      });
      items.push({ spacer: 2 });
      continue;
    }

    const wrapped = wrapText(block.text, 82);
    wrapped.forEach((line) => {
      items.push({
        text: line,
        x: 52,
        font: "F1",
        size: 12,
        leading: 18,
      });
    });
    items.push({ spacer: 4 });
  }

  return items;
}

function paginateItems(items = []) {
  const pages = [];
  let currentPage = [];
  let y = 760;

  for (const item of items) {
    if (item.spacer) {
      y -= item.spacer;
      if (y < 60) {
        pages.push(currentPage);
        currentPage = [];
        y = 760;
      }
      continue;
    }

    const wrappedLines = wrapText(item.text, item.wrap || 84);
    const blockHeight = wrappedLines.length * item.leading;

    if (y - blockHeight < 60) {
      pages.push(currentPage);
      currentPage = [];
      y = 760;
    }

    wrappedLines.forEach((line) => {
      currentPage.push({
        text: line,
        x: item.x,
        y,
        font: item.font,
        size: item.size,
      });
      y -= item.leading;
    });
  }

  if (currentPage.length) {
    pages.push(currentPage);
  }

  return pages.length ? pages : [[]];
}

function buildPageStream(lines = []) {
  return lines
    .map(
      (line) =>
        ["BT", `/${line.font} ${line.size} Tf`, `${line.x} ${line.y} Td`, `(${escapePdfText(line.text)}) Tj`, "ET"].join("\n"),
    )
    .join("\n");
}

function buildPdfFromPages(pageStreams = []) {
  const objects = [];
  const pageObjectIds = [];
  const fontObjectId = 3 + pageStreams.length * 2;
  const boldFontObjectId = fontObjectId + 1;

  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");

  pageStreams.forEach((_stream, index) => {
    pageObjectIds.push(3 + index * 2);
  });

  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>\nendobj`,
  );

  pageStreams.forEach((stream, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;

    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R /F2 ${boldFontObjectId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj`,
    );
    objects.push(
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj`,
    );
  });

  objects.push(`${fontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);
  objects.push(`${boldFontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

export function buildAnswerPdf({ title = "AI Tutor Answer", question = "", answer = "" }) {
  const normalizedAnswer = String(answer || "").trim();
  const isSingleWord = normalizedAnswer && !/\s/.test(normalizedAnswer);

  if (!title && !question && isSingleWord) {
    const stream = buildCenteredWordContent(normalizedAnswer);
    return buildPdfFromPages([stream]);
  }

  const items = buildLayoutItems({
    title,
    question,
    answer: normalizedAnswer || "No answer was available.",
  });
  const pages = paginateItems(items).map((page) => buildPageStream(page));
  return buildPdfFromPages(pages);
}
