import { BrainError } from "./gbrain-client";
import { safeMemoryText, safeSourceText, MAX_MEMORY_BYTES, MAX_SOURCE_BYTES } from "./brain-content";

// Extraction is server-only, bounded, and never executes document scripts or
// resolves embedded URLs. Large originals remain stored without being indexed.
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_BYTES = 40 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_WORD_XML_BYTES = 2 * 1024 * 1024;
const MAX_WORD_TOTAL_XML_BYTES = 4 * 1024 * 1024;
const wordPart = /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/;

export function documentFormat(key: string) {
  const extension = key.split(".").at(-1)?.toLowerCase();
  if (extension === "pdf" || extension === "docx") return extension;
  if (["txt", "md", "markdown", "csv", "json", "srt", "vtt"].includes(extension ?? "")) return "text";
  if (extension === "doc") throw new BrainError("Este Word usa el formato .doc antiguo. Conviértelo a .docx y vuelve a subirlo. El original se conserva.", 422);
  throw new BrainError("Se pueden procesar PDF con texto, Word .docx, TXT, Markdown, CSV y JSON. El original se conserva.", 422);
}

export async function boundedDocumentBytes(response: Response, maxBytes: number) {
  const limit = maxBytes >= 1024 * 1024 ? `${maxBytes / (1024 * 1024)} MiB` : maxBytes >= 1024 ? `${maxBytes / 1024} KiB` : `${maxBytes} bytes`;
  const tooLarge = () => new BrainError(`La carga supera el límite de ${limit}. No se recibió el contenido completo.`, 413);
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw tooLarge(); }
  const reader = response.body?.getReader();
  if (!reader) throw new BrainError("El archivo original está vacío.", 422);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const {value, done} = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw tooLarge(); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function extractedText(text: string, maxTextBytes = MAX_EXTRACTED_BYTES) {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\u000c/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (new TextEncoder().encode(normalized).byteLength > maxTextBytes) throw new BrainError(`El texto extraído supera ${maxTextBytes / 1024} KiB. Divide el documento en partes; no se envió texto incompleto. El original se conserva.`, 413);
  return maxTextBytes > MAX_EXTRACTED_BYTES ? safeSourceText(normalized) : safeMemoryText(normalized);
}

async function pdfText(bytes: Uint8Array, maxTextBytes: number) {
  if (!new TextDecoder().decode(bytes.subarray(0, 8)).startsWith("%PDF-")) throw new BrainError("El archivo no contiene un PDF válido. El original se conserva.", 422);
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes, {
    useWorkerFetch: false, useSystemFonts: false,
    disableFontFace: true, useWasm: false, maxImageSize: 1_000_000,
    stopAtErrors: true, verbosity: 0,
  });
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new BrainError("El PDF supera 100 páginas. Divídelo en partes para procesarlo. El original se conserva.", 413);
    const pages: string[] = []; let hasText = false;
    // Sequential pages bound memory and preserve page references for citations.
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
        hasText ||= !!text;
        pages.push(`[Página ${number}]\n${text || "[Sin texto extraíble en esta página; puede necesitar OCR.]"}`);
        if (new TextEncoder().encode(pages.join("\n\n")).byteLength > maxTextBytes) throw new BrainError(`El texto del PDF supera ${maxTextBytes / 1024} KiB. Divide el documento; no se envió texto incompleto. El original se conserva.`, 413);
      } finally { page.cleanup(); }
    }
    if (!hasText) throw new BrainError("Este PDF no contiene texto extraíble. Si es escaneado, necesita OCR antes de procesarlo. El original se conserva.", 422);
    return extractedText(pages.join("\n\n"),maxTextBytes);
  } finally { await pdf.loadingTask.destroy(); }
}

// Inspect the ZIP directory before inflating: reject oversized/ambiguous parts,
// ZIP64, encryption, duplicate names and archive bombs. Ignore images/macros.
function wordDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65558); end--) if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new BrainError("El archivo no contiene un Word .docx válido.", 422);
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count > 1000 || start === 0xffffffff || start + size !== end) throw new BrainError("Este Word usa una estructura ZIP no admitida o demasiado grande.", 422);
  const parts = new Map<string,{size:number;crc:number}>(), names = new Set<string>(); let offset = start, total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new BrainError("El archivo Word está incompleto o dañado.", 422);
    const flags = view.getUint16(offset + 8, true), compression = view.getUint16(offset + 10, true), compressed = view.getUint32(offset + 20, true), expanded = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true), extraSize = view.getUint16(offset + 30, true), commentSize = view.getUint16(offset + 32, true), local = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameSize + extraSize + commentSize;
    if (next > end || local + 30 > start || flags & 1 || ![0,8].includes(compression) || compressed === 0xffffffff || expanded === 0xffffffff) throw new BrainError("Este Word está protegido o usa una compresión no admitida.", 422);
    const name = new TextDecoder("utf-8", {fatal:true}).decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    if (names.has(name) || name.includes("..") || name.includes("\\") || name.startsWith("/")) throw new BrainError("El archivo Word contiene entradas ambiguas.", 422);
    names.add(name);
    if (view.getUint32(local, true) !== 0x04034b50 || local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true) + compressed > start) throw new BrainError("El archivo Word está incompleto o dañado.", 422);
    if (wordPart.test(name)) {
      total += expanded;
      if (expanded > MAX_WORD_XML_BYTES || total > MAX_WORD_TOTAL_XML_BYTES) throw new BrainError("El contenido interno de Word es demasiado grande. Divide el documento; el original se conserva.", 413);
      parts.set(name,{size:expanded,crc:view.getUint32(offset + 16,true)});
    }
    offset = next;
  }
  if (offset !== end || !parts.has("word/document.xml") || !names.has("[Content_Types].xml")) throw new BrainError("El archivo no contiene un documento Word .docx válido.", 422);
  return parts;
}

const crcTable = Uint32Array.from({length:256}, (_,value) => {
  let crc=value; for (let bit=0;bit<8;bit++) crc=crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc=0xffffffff; for (const byte of bytes) crc=crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}

async function wordText(bytes: Uint8Array, maxTextBytes: number) {
  if (bytes.length < 22) throw new BrainError("El archivo no contiene un Word .docx válido.", 422);
  const parts = wordDirectory(bytes);
  const [{unzipSync}, {XMLParser, XMLValidator}] = await Promise.all([import("fflate"), import("fast-xml-parser")]);
  const files = unzipSync(bytes, {filter: entry => parts.has(entry.name)});
  const parser = new XMLParser({preserveOrder:true, ignoreAttributes:true, removeNSPrefix:true, trimValues:false, parseTagValue:false, processEntities:true, maxNestedTags:100});
  const sections: string[] = []; let nodeCount = 0;
  function textNodes(nodes: Record<string, unknown>[], depth = 0): string {
    if (depth > 100 || (nodeCount += nodes.length) > 100_000) throw new BrainError("La estructura de Word es demasiado compleja para procesarla.", 413);
    return nodes.map(node => Object.entries(node).map(([tag, value]) => {
      if (tag === "#text") return String(value);
      if (["del", "instrText", "drawing", "pict", "object", "altChunk"].includes(tag)) return "";
      if (tag === "tab") return "\t";
      if (tag === "br" || tag === "cr") return "\n";
      const text = Array.isArray(value) ? textNodes(value as Record<string, unknown>[], depth + 1) : "";
      return text + (tag === "p" || tag === "tr" ? "\n" : tag === "tc" ? "\t" : "");
    }).join("")).join("");
  }
  for (const name of ["word/document.xml", ...[...parts.keys()].filter(name => name !== "word/document.xml").sort()]) {
    const expected=parts.get(name)!;
    if (files[name]?.length !== expected.size || crc32(files[name]) !== expected.crc) throw new BrainError("El contenido de Word no coincide con su archivo original; puede estar dañado. No se envió texto incompleto.", 422);
    const xml = new TextDecoder("utf-8", {fatal:true}).decode(files[name]);
    // Standard XML entities only; never resolve external entities or DTDs.
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new BrainError("El XML interno de Word no es válido o contiene entidades no admitidas.", 422);
    // Bound node allocation before constructing the XML tree, not only after.
    let tags=0;
    for (let position=xml.indexOf("<");position !== -1;position=xml.indexOf("<",position+1)) if (++tags > 50_000) throw new BrainError("La estructura de Word es demasiado compleja. Divide el documento; el original se conserva.", 413);
    const text = textNodes(parser.parse(xml)).trim();
    if (text) sections.push(name === "word/document.xml" ? text : `[${name.includes("header") ? "Encabezado" : name.includes("footer") ? "Pie de página" : "Notas"}]\n${text}`);
  }
  if (!sections.length) throw new BrainError("Este Word no contiene texto extraíble. Las imágenes no se leen sin OCR. El original se conserva.", 422);
  return extractedText(sections.join("\n\n"),maxTextBytes);
}

// Only one heavy parser per isolate. A timeout is not a CPU sandbox; byte/page/
// archive limits also apply. A cancelled parse never starts a GBrain write.
let extracting = false;
export async function extractDocumentText(key: string, bytes: Uint8Array, meeting = false) {
  const format = documentFormat(key), max = format === "text" ? meeting ? 256 * 1024 : MAX_MEMORY_BYTES : MAX_DOCUMENT_BYTES;
  if (!bytes.length || bytes.length > max) throw new BrainError("El archivo está vacío o supera el límite de procesamiento. El original se conserva.", bytes.length ? 413 : 422);
  if (format === "text") {
    try { return (meeting ? safeSourceText : safeMemoryText)(new TextDecoder("utf-8", {fatal:true}).decode(bytes).replace(/^\uFEFF/, "")); }
    catch (error) { if (error instanceof BrainError) throw error; throw new BrainError("El archivo debe estar codificado en UTF-8.", 422); }
  }
  if (extracting) throw new BrainError("Hay otro documento en procesamiento. Reintenta en unos segundos.", 429);
  extracting = true;
  const maxTextBytes = meeting ? MAX_SOURCE_BYTES : MAX_EXTRACTED_BYTES;
  const task = (format === "pdf" ? pdfText(bytes,maxTextBytes) : wordText(bytes,maxTextBytes)).finally(() => {extracting = false;});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {timeout = setTimeout(() => reject(new BrainError("La extracción tardó demasiado. Divide el documento o vuelve a intentarlo; el original se conserva.", 503)), 15000);})]);
  } catch (error) {
    if (error instanceof BrainError) throw error;
    if (error instanceof Error && error.name === "PasswordException") throw new BrainError("El PDF está protegido con contraseña. Sube una copia sin protección; el original se conserva.", 422);
    throw new BrainError(`No se pudo leer este ${format === "pdf" ? "PDF" : "Word"}. Comprueba que no esté dañado o protegido. El original se conserva.`, 422);
  } finally { if (timeout) clearTimeout(timeout); }
}
