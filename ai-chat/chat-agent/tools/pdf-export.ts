import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, extname } from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Simple Markdown to text conversion for PDF.
 * Strips formatting markers but preserves structure.
 */
function markdownToText(markdown: string): string {
  let text = markdown;

  // Convert headings to uppercase with underlines
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_match, content: string) => {
    return `\n${content.toUpperCase()}\n${"─".repeat(content.length)}\n`;
  });

  // Remove bold/italic markers but keep text
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/\*(.+?)\*/g, "$1");
  text = text.replace(/___(.+?)___/g, "$1");
  text = text.replace(/__(.+?)__/g, "$1");
  text = text.replace(/_(.+?)_/g, "$1");

  // Remove strikethrough
  text = text.replace(/~~(.+?)~~/g, "$1");

  // Remove inline code markers
  text = text.replace(/`(.+?)`/g, "$1");

  // Convert links to text with URL
  text = text.replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");

  // Convert images to placeholder
  text = text.replace(/!\[(.+?)\]\((.+?)\)/g, "[Image: $1]");

  // Convert unordered lists
  text = text.replace(/^[-*+]\s+/gm, "  - ");

  // Convert ordered lists
  text = text.replace(/^(\d+)\.\s+/gm, "  $1. ");

  // Convert blockquotes
  text = text.replace(/^>\s*/gm, "│ ");

  // Convert horizontal rules
  text = text.replace(
    /^(-{3,}|\*{3,}|_{3,})$/gm,
    "\n" + "─".repeat(50) + "\n"
  );

  // Handle code blocks - indent content
  text = text.replace(/```[\w]*\n([\s\S]*?)```/g, (_match, code: string) => {
    return code
      .split("\n")
      .map((line: string) => "    " + line)
      .join("\n");
  });

  return text;
}

/**
 * Word wrap text to fit within a given width.
 */
function wordWrap(text: string, maxWidth = 80): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const para of paragraphs) {
    if (para.length <= maxWidth) {
      lines.push(para);
      continue;
    }

    const words = para.split(" ");
    let currentLine = "";

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxWidth) {
        currentLine += (currentLine ? " " : "") + word;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = word;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

interface PageDimensions {
  width: number;
  height: number;
}

const PAGE_SIZES: Record<string, PageDimensions> = {
  letter: { width: 612, height: 792 }, // 8.5 x 11 inches
  legal: { width: 612, height: 1008 }, // 8.5 x 14 inches
  a4: { width: 595, height: 842 }, // 210 x 297 mm
  a3: { width: 842, height: 1191 }, // 297 x 420 mm
  a5: { width: 420, height: 595 }, // 148 x 210 mm
  tabloid: { width: 792, height: 1224 }, // 11 x 17 inches
};

function getPageDimensions(size: string): PageDimensions {
  return PAGE_SIZES[size.toLowerCase()] || PAGE_SIZES.letter;
}

// ── Execute ──────────────────────────────────────────────────

async function execute(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const inputPath = args.inputPath as string | undefined;
  const outputPath = args.outputPath as string | undefined;
  const content = args.content as string | undefined;
  const title = args.title as string | undefined;
  const author = args.author as string | undefined;
  const fontSize = (args.fontSize as number) ?? 12;
  const margin = (args.margin as number) ?? 50;
  const pageSize = (args.pageSize as string) ?? "letter";
  const convertMarkdown = (args.convertMarkdown as boolean) ?? true;

  if (!sessionId) {
    return formatError("sessionId is required for sandbox isolation");
  }

  if (!inputPath && !content) {
    return formatError("Either inputPath or content is required");
  }

  const sandboxPath = await ctx.sandbox.ensureSandbox(sessionId);

  try {
    // Get content
    let textContent: string;
    let inputFileName = "content";

    if (inputPath) {
      const absInputPath = join(sandboxPath, inputPath);

      if (!existsSync(absInputPath)) {
        return formatError(`Input file not found: ${inputPath}`);
      }

      textContent = await readFile(absInputPath, "utf-8");
      inputFileName = inputPath;

      // Check if it's a markdown file
      const ext = extname(inputPath).toLowerCase();
      if (convertMarkdown && (ext === ".md" || ext === ".markdown")) {
        textContent = markdownToText(textContent);
      }
    } else {
      textContent = content!;
      if (convertMarkdown) {
        textContent = markdownToText(textContent);
      }
    }

    // Create PDF document
    const pdfDoc = await PDFDocument.create();

    // Set metadata
    if (title) pdfDoc.setTitle(title);
    if (author) pdfDoc.setAuthor(author);
    pdfDoc.setCreationDate(new Date());
    pdfDoc.setProducer("YayAgent PDF Export Tool");

    // Get page dimensions based on page size
    const pageDimensions = getPageDimensions(pageSize);
    const pageWidth = pageDimensions.width;
    const pageHeight = pageDimensions.height;

    // Embed font
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Calculate text area
    const textWidth = pageWidth - 2 * margin;
    const textHeight = pageHeight - 2 * margin;
    const lineHeight = fontSize * 1.4;
    const charsPerLine = Math.floor(textWidth / (fontSize * 0.5));
    const linesPerPage = Math.floor(textHeight / lineHeight);

    // Word wrap content
    const wrappedLines = wordWrap(textContent, charsPerLine);

    // Create pages and add text
    let currentLine = 0;
    let pageCount = 0;

    while (currentLine < wrappedLines.length) {
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      pageCount++;

      let y = pageHeight - margin;

      // Add title on first page
      if (pageCount === 1 && title) {
        page.drawText(title, {
          x: margin,
          y: y,
          size: fontSize + 4,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        y -= lineHeight * 2;
      }

      // Add content lines
      for (
        let i = 0;
        i < linesPerPage && currentLine < wrappedLines.length;
        i++
      ) {
        const line = wrappedLines[currentLine];

        // Check if line looks like a heading (uppercase followed by underline)
        const isHeading =
          line === line.toUpperCase() &&
          line.length > 0 &&
          currentLine + 1 < wrappedLines.length &&
          wrappedLines[currentLine + 1].startsWith("─");

        page.drawText(line, {
          x: margin,
          y: y,
          size: isHeading ? fontSize + 2 : fontSize,
          font: isHeading ? boldFont : font,
          color: rgb(0, 0, 0),
        });

        y -= lineHeight;
        currentLine++;

        if (y < margin) break;
      }

      // Add page number
      const pageNumText = `Page ${pageCount}`;
      const pageNumWidth = font.widthOfTextAtSize(pageNumText, 10);
      page.drawText(pageNumText, {
        x: (pageWidth - pageNumWidth) / 2,
        y: margin / 2,
        size: 10,
        font: font,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    // Generate PDF bytes
    const pdfBytes = await pdfDoc.save();

    // Determine output path
    const outputFileName =
      outputPath ||
      (inputPath ? inputPath.replace(/\.[^.]+$/, ".pdf") : "output.pdf");
    const absOutputPath = join(sandboxPath, outputFileName);

    // Write output
    await writeFile(absOutputPath, pdfBytes);

    return formatResponse({
      success: true,
      inputPath: inputFileName,
      outputPath: outputFileName,
      pageCount,
      fileSize: pdfBytes.length,
      lineCount: wrappedLines.length,
      sandboxPath,
    });
  } catch (err: any) {
    return formatError(`PDF export failed: ${err.message}`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const pdfExportTool: Tool = {
  name: "pdf_export",
  description:
    "Export text content, files, or Markdown to PDF format. Supports automatic Markdown conversion, page sizing, custom fonts, and metadata. Useful for generating reports, documentation, or printable output.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID for sandbox isolation (required)",
      },
      inputPath: {
        type: "string",
        description:
          "Path to input file (relative to sandbox). Markdown files are auto-converted.",
      },
      outputPath: {
        type: "string",
        description:
          "Path for output PDF file (optional, defaults to input name with .pdf extension)",
      },
      content: {
        type: "string",
        description:
          "Text or Markdown content as string (alternative to inputPath)",
      },
      title: {
        type: "string",
        description: "PDF document title metadata",
      },
      author: {
        type: "string",
        description: "PDF document author metadata",
      },
      fontSize: {
        type: "number",
        default: 12,
        description: "Font size in points",
      },
      margin: {
        type: "number",
        default: 50,
        description: "Page margin in points",
      },
      pageSize: {
        type: "string",
        enum: ["letter", "legal", "a4", "a3", "a5", "tabloid"],
        default: "letter",
        description: "Page size",
      },
      convertMarkdown: {
        type: "boolean",
        default: true,
        description: "Convert Markdown formatting to plain text structure",
      },
    },
    required: ["sessionId"],
  },
  execute,
};

export default pdfExportTool;
