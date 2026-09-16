/**
 * Minimal, dependency-free Office Open XML exporter.
 *
 * A `.docx` file is a ZIP package, not an HTML file renamed as `.doc`.  Keeping
 * this encoder here lets the renderer generate a real Word document without
 * granting it direct filesystem access or adding a second document runtime.
 */

export interface DocxChapter {
  readonly chapterNumber: number
  readonly title: string
  readonly content: string
}

const encoder = new TextEncoder()
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/gu, character => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' }[character] ?? character
  ))
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(target: number[], value: number): void {
  target.push(value & 0xff, (value >>> 8) & 0xff)
}

function writeUint32(target: number[], value: number): void {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

interface ZipEntry {
  readonly name: string
  readonly data: Uint8Array
  readonly crc: number
  readonly offset: number
}

/** Creates an uncompressed ZIP package; OOXML readers universally support it. */
function zip(files: readonly { name: string; content: string }[]): Uint8Array {
  const output: number[] = []
  const entries: ZipEntry[] = []
  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = encoder.encode(file.content)
    const entry: ZipEntry = { name: file.name, data, crc: crc32(data), offset: output.length }
    entries.push(entry)
    writeUint32(output, 0x04034b50)
    writeUint16(output, 20)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint32(output, entry.crc)
    writeUint32(output, data.length)
    writeUint32(output, data.length)
    writeUint16(output, name.length)
    writeUint16(output, 0)
    output.push(...name, ...data)
  }
  const directoryOffset = output.length
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    writeUint32(output, 0x02014b50)
    writeUint16(output, 20)
    writeUint16(output, 20)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint32(output, entry.crc)
    writeUint32(output, entry.data.length)
    writeUint32(output, entry.data.length)
    writeUint16(output, name.length)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint32(output, 0)
    writeUint32(output, entry.offset)
    output.push(...name)
  }
  const directorySize = output.length - directoryOffset
  writeUint32(output, 0x06054b50)
  writeUint16(output, 0)
  writeUint16(output, 0)
  writeUint16(output, entries.length)
  writeUint16(output, entries.length)
  writeUint32(output, directorySize)
  writeUint32(output, directoryOffset)
  writeUint16(output, 0)
  return Uint8Array.from(output)
}

function paragraph(text: string, heading = false): string {
  const content = text.length === 0
    ? '<w:r><w:t xml:space="preserve"></w:t></w:r>'
    : `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  return `<w:p>${heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''}${content}</w:p>`
}

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  // 24,576 is divisible by three, so chunk boundaries never alter base64 padding.
  for (let offset = 0; offset < bytes.length; offset += 24_576) {
    let binary = ''
    const end = Math.min(offset + 24_576, bytes.length)
    for (let index = offset; index < end; index += 1) binary += String.fromCharCode(bytes[index]!)
    parts.push(btoa(binary))
  }
  return parts.join('')
}

export function createDocxBase64(
  projectName: string,
  writingLanguage: 'zh-CN' | 'en-US',
  chapters: readonly DocxChapter[],
): string {
  const paragraphs = [paragraph(projectName, true)]
  for (const chapter of chapters) {
    const heading = writingLanguage === 'en-US'
      ? `Chapter ${chapter.chapterNumber}${chapter.title ? ` ${chapter.title}` : ''}`
      : `第${chapter.chapterNumber}章${chapter.title ? ` ${chapter.title}` : ''}`
    paragraphs.push(paragraph(heading, true))
    for (const line of chapter.content.replace(/\r\n?/gu, '\n').split('\n')) paragraphs.push(paragraph(line))
  }
  const document = `${XML_HEADER}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
  const files = [
    { name: '[Content_Types].xml', content: `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', content: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'word/document.xml', content: document },
    { name: 'docProps/core.xml', content: `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(projectName)}</dc:title><dc:creator>AI Novel Writer</dc:creator></cp:coreProperties>` },
  ]
  return toBase64(zip(files))
}
