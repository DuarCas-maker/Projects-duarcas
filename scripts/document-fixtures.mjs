import { zipSync, strToU8 } from "fflate";

// Synthetic fixtures only: no customer files or credentials.
export function pdfFixture(text = "Documento ficticio: el material sera azul y la entrega sera el martes.", pages = 1) {
  const escaped = text.replace(/[\\()]/g, "\\$&");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array.from({length:pages},(_,index)=>`${4+index*2} 0 R`).join(" ")}] /Count ${pages} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (let index=0; index<pages; index++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+index*2} 0 R >>`);
    const stream = text ? `BT /F1 12 Tf 40 740 Td (${escaped}) Tj ET` : "";
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let pdf="%PDF-1.7\n"; const offsets=[0];
  for(let index=0;index<objects.length;index++) { offsets.push(Buffer.byteLength(pdf)); pdf+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

export function docxFixture(text = "Documento ficticio: la revisión será el miércoles y el color será violeta.", extra = {}) {
  const escaped = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return zipSync({
    "[Content_Types].xml":strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels":strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml":strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Tabla: fuente ficticia</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:del><w:r><w:delText>Texto eliminado que no debe indexarse</w:delText></w:r></w:del></w:body></w:document>`),
    ...extra,
  });
}
