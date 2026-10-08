import assert from "node:assert/strict";
import vm from "node:vm";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {strToU8} from "fflate";
import {pdfFixture,docxFixture} from "./document-fixtures.mjs";

const context=vm.createContext({crypto,TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,Response,URL,setTimeout,clearTimeout,console});
async function external(name) {
  const value=await import(name), module=new vm.SyntheticModule(Object.keys(value),function(){for(const key of Object.keys(value))this.setExport(key,value[key]);},{context});
  await module.link(()=>{});await module.evaluate();return module;
}
const compiled=await build({entryPoints:[fileURLToPath(new URL("../lib/brain-documents.ts",import.meta.url))],bundle:true,format:"esm",platform:"node",packages:"external",write:false});
const root=new vm.SourceTextModule(compiled.outputFiles[0].text,{context,importModuleDynamically:external});await root.link(()=>{});await root.evaluate();
const {extractDocumentText,boundedDocumentBytes,documentFormat}=root.namespace;
const pdf=await extractDocumentText("example.pdf",pdfFixture());assert.match(pdf,/\[Página 1\]/);assert.match(pdf,/material sera azul/);
const word=await extractDocumentText("example.docx",docxFixture());assert.match(word,/miércoles/);assert.match(word,/Tabla: fuente ficticia/);assert.ok(!word.includes("Texto eliminado"));
const err=message=>error=>error.message.includes(message);
assert.throws(()=>documentFormat("legacy.doc"),err(".docx"));
await assert.rejects(extractDocumentText("scanned.pdf",pdfFixture("")),err("OCR"));
await assert.rejects(extractDocumentText("large.pdf",pdfFixture("Ficticio",101)),err("100 páginas"));
await assert.rejects(extractDocumentText("damaged.pdf",strToU8("not a PDF")),err("PDF válido"));
await assert.rejects(extractDocumentText("damaged.docx",strToU8("not a Word")),err(".docx válido"));
await assert.rejects(extractDocumentText("oversize.docx",docxFixture("x".repeat(45000))),err("40 KiB"));
await assert.rejects(extractDocumentText("secrets.docx",docxFixture("API_KEY=synthetic-sensitive-value")),err("credenciales"));
await assert.rejects(extractDocumentText("entity.docx",docxFixture("Synthetic",{"word/document.xml":strToU8('<!DOCTYPE w:document [<!ENTITY leak SYSTEM "https://unapproved.example/secret">]><w:document>&leak;</w:document>')})),err("entidades"));
await assert.rejects(extractDocumentText("invalid.txt",new Uint8Array([0xff,0xfe])),err("UTF-8"));
await assert.rejects(boundedDocumentBytes(new Response("12345"),3),err("límite"));
const bomb=docxFixture();const view=new DataView(bomb.buffer);for(let i=0;i<bomb.length-46;i++) {if(view.getUint32(i,true)===0x02014b50 && new TextDecoder().decode(bomb.subarray(i+46,i+46+view.getUint16(i+28,true)))==="word/document.xml") {view.setUint32(i+24,0xfffffff0,true);break;}}
await assert.rejects(extractDocumentText("bomb.docx",bomb),err("demasiado grande"));
console.log(JSON.stringify({passed:true,pdfTextAndPages:true,docxTextAndTables:true,deletedTextExcluded:true,scannedNeedsOCR:true,oversizeRejected:true,legacyDocExplained:true,secretTextRejected:true,archiveBombAndEntitiesRejected:true,utf8Validated:true}));
