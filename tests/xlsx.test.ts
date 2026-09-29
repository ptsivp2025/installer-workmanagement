import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'zlib';
import { buildXlsx } from '@/lib/xlsx';

/** Reads the (stored, uncompressed) zip back into { name: text }. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, string> = {};
  let pos = 0;
  while (view.getUint32(pos, true) === 0x04034b50) {
    const method = view.getUint16(pos + 8, true);
    const size = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const name = new TextDecoder().decode(bytes.slice(pos + 30, pos + 30 + nameLen));
    const start = pos + 30 + nameLen + extraLen;
    const raw = bytes.slice(start, start + size);
    out[name] = new TextDecoder().decode(method === 0 ? raw : inflateRawSync(raw));
    pos = start + size;
  }
  return out;
}

describe('buildXlsx', () => {
  const files = unzip(buildXlsx([
    { name: 'Kegiatan', rows: [['No', 'Judul', 'Jarak'], ['R-1', 'Pasang <videowall> & tes', 12], ['R-2', null, 3.5]] },
    { name: 'Rekap/Installer', rows: [['Nama'], ['Budi']] },
  ]));

  it('contains every part Excel needs', () => {
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
      'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      expect(files[part], part).toBeDefined();
    }
  });

  it('escapes text and keeps numbers numeric', () => {
    const s1 = files['xl/worksheets/sheet1.xml'];
    expect(s1).toContain('Pasang &lt;videowall&gt; &amp; tes');
    expect(s1).toContain('<c r="C2"><v>12</v></c>');
    expect(s1).toContain('<c r="B3"/>');
    expect(s1).toContain('s="1"'); // bold header style
  });

  it('removes characters Excel forbids in sheet names', () => {
    expect(files['xl/workbook.xml']).toContain('name="Rekap Installer"');
  });
});
