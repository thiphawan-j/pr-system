import "server-only";

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit, { type Font, type Glyph } from "@pdf-lib/fontkit";
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFOperator, PDFOperatorNames, PDFString, TextRenderingMode,
  appendBezierCurve, beginText, closePath, endText, fill, lineTo, moveTo,
  popGraphicsState, pushGraphicsState, rgb, scale, setCharacterSqueeze,
  setFillingRgbColor, setFontAndSize, setTextMatrix, setTextRenderingMode,
  showText, translate,
  type PDFPage, type PDFFont, type PDFRef,
} from "pdf-lib";

import type { PurchaseOrderDocument, PurchaseOrderDocumentText } from "@/lib/purchase-order-document";

type FontFace = { bytes: Uint8Array; shape: Font; script: "thai" | "latin" };
type FontWeight = { thai: FontFace; latin: FontFace };
export type PurchaseOrderFonts = { regular: FontWeight; bold: FontWeight };
type FontRun = { text: string; face: FontFace };
type LogicalFont = { ref: PDFRef; cids: Map<string, number>; widths: Map<string, number> };

let fontsPromise: Promise<PurchaseOrderFonts> | undefined;
const glyphOutlines = new WeakMap<Font, Map<number, PDFOperator[]>>();

/** Bundled fonts are shared; document text and font subsets remain per PDF. */
export function loadPurchaseOrderFonts(): Promise<PurchaseOrderFonts> {
  fontsPromise ??= (async () => {
    const files = ["thai-400", "latin-400", "thai-700", "latin-700"] as const;
    const faces = await Promise.all(files.map(async (file): Promise<FontFace> => {
      const bytes = await readFile(path.join(process.cwd(), "node_modules/@fontsource/noto-sans-thai/files", `noto-sans-thai-${file}-normal.woff`));
      return { bytes, shape: fontkit.create(bytes), script: file.startsWith("thai") ? "thai" : "latin" };
    }));
    return { regular: { thai: faces[0]!, latin: faces[1]! }, bold: { thai: faces[2]!, latin: faces[3]! } };
  })().catch((error: unknown) => { fontsPromise = undefined; throw error; });
  return fontsPromise;
}

function fontRuns(text: string, weight: FontWeight): FontRun[] {
  const runs: FontRun[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    const face = weight.latin.shape.hasGlyphForCodePoint(codePoint) ? weight.latin : weight.thai;
    const last = runs[runs.length - 1];
    if (last?.face === face) last.text += character;
    else runs.push({ text: character, face });
  }
  return runs;
}

function runWidth(run: FontRun, size: number): number {
  return run.face.shape.layout(run.text).positions.reduce((sum, position) => sum + position.xAdvance, 0) * size / run.face.shape.unitsPerEm;
}

/** The layout and renderer use the same fontkit shaping advances. */
export function measurePurchaseOrderText(text: string, size: number, bold: boolean, fonts: PurchaseOrderFonts): number {
  return fontRuns(text, bold ? fonts.bold : fonts.regular).reduce((sum, run) => sum + runWidth(run, size), 0);
}

function glyphOperators(face: FontFace, glyph: Glyph): PDFOperator[] {
  let cache = glyphOutlines.get(face.shape);
  if (!cache) { cache = new Map(); glyphOutlines.set(face.shape, cache); }
  const cached = cache.get(glyph.id);
  if (cached) return cached;
  const operators: PDFOperator[] = [];
  let currentX = 0, currentY = 0;
  let startX = 0, startY = 0;
  // Fontkit exposes the glyph outline through its Canvas-style path API.
  // Convert quadratic curves to cubic curves rather than using PDF's v operator.
  glyph.path.toFunction()({
    moveTo(x: number, y: number) {
      operators.push(moveTo(x, y)); currentX = startX = x; currentY = startY = y;
    },
    lineTo(x: number, y: number) {
      operators.push(lineTo(x, y)); currentX = x; currentY = y;
    },
    quadraticCurveTo(controlX: number, controlY: number, x: number, y: number) {
      operators.push(appendBezierCurve(
        currentX + (controlX - currentX) * 2 / 3, currentY + (controlY - currentY) * 2 / 3,
        x + (controlX - x) * 2 / 3, y + (controlY - y) * 2 / 3, x, y,
      ));
      currentX = x; currentY = y;
    },
    bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
      operators.push(appendBezierCurve(x1, y1, x2, y2, x, y)); currentX = x; currentY = y;
    },
    closePath() { operators.push(closePath()); currentX = startX; currentY = startY; },
  });
  cache.set(glyph.id, operators);
  return operators;
}

function color(value = "#173c4b"): ReturnType<typeof rgb> {
  const hex = value.replace(/^#/, "");
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return rgb(parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255);
}

async function logicalFont(pdf: PDFDocument, face: FontFace, font: PDFFont, characters: Set<string>): Promise<LogicalFont> {
  const values = [...characters];
  font.encodeText(values.join(""));
  await font.embed();
  const base = pdf.context.lookup(font.ref, PDFDict);
  const descendant = base.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
  const subset = face.shape.createSubset();
  const glyphs = values.map((character) => face.shape.glyphForCodePoint(character.codePointAt(0)!));
  const glyphIds = glyphs.map((glyph) => subset.includeGlyph(glyph));
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    // Fontkit's stream emits Node error events omitted from its bundled types.
    const stream = subset.encodeStream() as unknown as {
      on(event: "data", listener: (chunk: Uint8Array) => void): void;
      on(event: "end", listener: () => void): void;
      on(event: "error", listener: (error: Error) => void): void;
    };
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
  const descriptor = descendant.lookup(PDFName.of("FontDescriptor"), PDFDict).clone(pdf.context);
  descriptor.set(PDFName.of("FontFile2"), pdf.context.register(pdf.context.flateStream(bytes)));
  const mapping = new Uint8Array((values.length + 1) * 2);
  glyphIds.forEach((glyphId, index) => { mapping[(index + 1) * 2] = glyphId >>> 8; mapping[(index + 1) * 2 + 1] = glyphId & 255; });
  const widths = glyphs.map((glyph) => glyph.advanceWidth * 1000 / face.shape.unitsPerEm);
  const cids = new Map(values.map((character, index) => [character, index + 1]));
  const entries = values.map((character, index) => `<${(index + 1).toString(16).padStart(4, "0")}> <${PDFHexString.fromText(character).asString().slice(4)}>`);
  const blocks: string[] = [];
  for (let index = 0; index < entries.length; index += 100) {
    const block = entries.slice(index, index + 100);
    blocks.push(`${block.length} beginbfchar\n${block.join("\n")}\nendbfchar`);
  }
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /LogicalUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${blocks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const cidFont = pdf.context.register(pdf.context.obj({
    Type: "Font", Subtype: "CIDFontType2", BaseFont: base.get(PDFName.of("BaseFont")),
    CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Identity"), Supplement: 0 },
    FontDescriptor: pdf.context.register(descriptor),
    CIDToGIDMap: pdf.context.register(pdf.context.flateStream(mapping)), DW: 0, W: [1, widths],
  }));
  const ref = pdf.context.register(pdf.context.obj({
    Type: "Font", Subtype: "Type0", BaseFont: base.get(PDFName.of("BaseFont")), Encoding: "Identity-H",
    DescendantFonts: [cidFont], ToUnicode: pdf.context.register(pdf.context.flateStream(cmap)),
  }));
  return { ref, cids, widths: new Map(values.map((character, index) => [character, widths[index]!])) };
}

function drawRun(page: PDFPage, run: FontRun, font: PDFFont, logical: LogicalFont | undefined, x: number, y: number, size: number, ink: ReturnType<typeof rgb>) {
  const shaped = run.face.shape.layout(run.text);
  const factor = size / run.face.shape.unitsPerEm;
  if (run.face.script === "latin") {
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    const encoded = font.encodeText(run.text).asString();
    const adjusted = shaped.glyphs.flatMap((glyph, index) => {
      const position = shaped.positions[index]!;
      const ratio = 1000 / run.face.shape.unitsPerEm;
      return [-position.xOffset * ratio, PDFHexString.of(encoded.slice(index * 4, index * 4 + 4)), (glyph.advanceWidth + position.xOffset - position.xAdvance) * ratio];
    });
    page.pushOperators(
      pushGraphicsState(), setFillingRgbColor(ink.red, ink.green, ink.blue), beginText(), setFontAndSize(fontKey, size),
      setTextMatrix(1, 0, 0, 1, x, y), PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [page.doc.context.obj(adjusted)]), endText(), popGraphicsState(),
    );
    return;
  }
  let penX = 0, penY = 0;
  for (let index = 0; index < shaped.glyphs.length; index++) {
    const glyph = shaped.glyphs[index]!;
    const position = shaped.positions[index]!;
    const outline = glyphOperators(run.face, glyph);
    if (outline.length) page.pushOperators(
      pushGraphicsState(), setFillingRgbColor(ink.red, ink.green, ink.blue),
      translate(x + (penX + position.xOffset) * factor, y + (penY + position.yOffset) * factor),
      scale(factor, factor), ...outline, fill(), popGraphicsState(),
    );
    penX += position.xAdvance; penY += position.yAdvance;
  }

  // Positioned combining glyphs cause PDFKit to invent spaces inside Thai words.
  // Keep a separate one-codepoint-per-CID font for the logical text layer.
  // Shaping can reuse one glyph for both า and part of ำ, so a glyph-based
  // ToUnicode map cannot reliably represent the original Unicode characters.
  const fontKey = page.node.newFontDictionary("LogicalThai", logical!.ref);
  const encoded = [...run.text].map((character) => logical!.cids.get(character)!.toString(16).padStart(4, "0")).join("");
  const naturalWidth = [...run.text].reduce((sum, character) => sum + logical!.widths.get(character)!, 0) * size / 1000;
  const shapedWidth = penX * factor;
  page.pushOperators(
    pushGraphicsState(), beginText(), setFontAndSize(fontKey, size),
    setTextMatrix(1, 0, 0, 1, x, y), setTextRenderingMode(TextRenderingMode.Invisible),
    setCharacterSqueeze(naturalWidth > 0 ? shapedWidth / naturalWidth * 100 : 100),
    showText(PDFHexString.of(encoded)), endText(), popGraphicsState(),
  );
}

function drawText(page: PDFPage, element: PurchaseOrderDocumentText, height: number, fonts: PurchaseOrderFonts, embedded: Map<FontFace, PDFFont>, logical: Map<FontFace, LogicalFont>) {
  const weight = element.bold ? fonts.bold : fonts.regular;
  const runs = fontRuns(element.text, weight);
  const width = runs.reduce((sum, run) => sum + runWidth(run, element.size), 0);
  let x = element.x - (element.align === "right" ? width : element.align === "center" ? width / 2 : 0);
  for (const run of runs) {
    drawRun(page, run, embedded.get(run.face)!, logical.get(run.face), x, height - element.y, element.size, color(element.color));
    x += runWidth(run, element.size);
  }
}

export async function createPurchaseOrderPdf(document: PurchaseOrderDocument): Promise<Uint8Array> {
  const fonts = await loadPurchaseOrderFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`Purchase Order ${document.poNumber}`);
  pdf.setSubject("Purchase order");
  pdf.catalog.set(PDFName.of("Lang"), PDFString.of("th-TH"));
  const embedded = new Map<FontFace, PDFFont>();
  for (const face of [fonts.regular.thai, fonts.regular.latin, fonts.bold.thai, fonts.bold.latin]) {
    embedded.set(face, await pdf.embedFont(face.bytes, { subset: true }));
  }
  const characters = new Map<FontFace, Set<string>>();
  for (const plan of document.pages) for (const element of plan.elements) {
    if (element.type !== "text") continue;
    for (const run of fontRuns(element.text, element.bold ? fonts.bold : fonts.regular)) {
      if (run.face.script !== "thai") continue;
      const values = characters.get(run.face) ?? new Set<string>();
      for (const character of run.text) values.add(character);
      characters.set(run.face, values);
    }
  }
  const logical = new Map<FontFace, LogicalFont>();
  for (const [face, values] of characters) logical.set(face, await logicalFont(pdf, face, embedded.get(face)!, values));
  for (const plan of document.pages) {
    const page = pdf.addPage([document.width, document.height]);
    for (const element of plan.elements) {
      if (element.type === "text") drawText(page, element, document.height, fonts, embedded, logical);
      else if (element.type === "line") page.drawLine({
        start: { x: element.x, y: document.height - element.y }, end: { x: element.x2, y: document.height - element.y2 },
        color: color(element.color), thickness: 0.6,
      });
      else if (element.fill || element.stroke) page.drawRectangle({
        x: element.x, y: document.height - element.y - element.height, width: element.width, height: element.height,
        color: element.fill ? color(element.fill) : undefined,
        borderColor: element.stroke ? color(element.stroke) : undefined, borderWidth: element.stroke ? 0.6 : 0,
      });
    }
  }
  return pdf.save();
}
