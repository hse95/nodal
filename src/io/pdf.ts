/**
 * A very small PDF writer: pages of text, lines and filled rectangles in the built-in Helvetica fonts.
 * It is enough for reports made of headings, paragraphs and tables, and needs no library.
 */
export interface PdfText { size?: number; bold?: boolean; color?: [number, number, number]; align?: 'left' | 'right' }
// Characters outside the built-in font's Latin-1 range are written with the closest plain equivalent.
const PLAIN: Record<string, string> = { '≤': '<=', '≥': '>=', '≈': '~', '→': '->', '−': '-', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', 'δ': 'delta', 'σ': 'sigma', 'π': 'pi', 'λ': 'lambda', 'φ': 'phi', 'ω': 'omega', 'θ': 'theta', 'ν': 'nu', 'ρ': 'rho', 'ε': 'eps', 'α': 'alpha', 'β': 'beta', 'Σ': 'Sum', 'Δ': 'Delta', '√': 'sqrt', '∞': 'inf', '⁴': '^4', '⁰': '^0', '′': "'", '·': '·', '×': '×', '²': '²', '³': '³', '°': '°', '±': '±', 'µ': 'µ' };
export function latin(text: string): string { let out = ''; for (const ch of String(text)) { const c = PLAIN[ch] ?? ch; for (const x of c) out += x.charCodeAt(0) <= 255 ? x : '?'; } return out; }
const esc = (s: string) => latin(s).replace(/([\\()])/g, '\\$1');
// Approximate widths of Helvetica glyphs (thousandths of the font size); good enough to wrap and right-align.
const W: Record<string, number> = { ' ': 278, i: 222, j: 222, l: 222, I: 278, f: 278, t: 278, r: 333, '.': 278, ',': 278, ':': 278, ';': 278, '!': 278, '|': 260, "'": 191, '(': 333, ')': 333, '-': 333, '/': 278, m: 833, w: 722, M: 833, W: 944, '%': 889, '@': 1015 };
export function textWidth(text: string, size: number, bold = false): number { let w = 0; for (const ch of latin(text)) w += W[ch] ?? (/[A-Z]/.test(ch) ? 680 : /[0-9]/.test(ch) ? 556 : 540); return w * size / 1000 * (bold ? 1.06 : 1); }

export class Pdf {
  readonly width = 595.28; readonly height = 841.89; readonly margin = 48;
  private pages: string[] = [];
  private cur = '';
  y = 0;
  constructor() { this.addPage(); }
  addPage(): void { if (this.cur) this.pages.push(this.cur); this.cur = ''; this.y = this.height - this.margin; }
  /** Start a new page if fewer than `need` points are left. */
  room(need: number): void { if (this.y - need < this.margin) this.addPage(); }
  text(x: number, y: number, s: string, o: PdfText = {}): void {
    const size = o.size ?? 10, c = o.color ?? [0.12, 0.14, 0.18], tx = o.align === 'right' ? x - textWidth(s, size, o.bold) : x;
    this.cur += `BT /${o.bold ? 'F2' : 'F1'} ${size} Tf ${c[0]} ${c[1]} ${c[2]} rg ${tx.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET\n`;
  }
  line(x1: number, y1: number, x2: number, y2: number, gray = 0.75, w = 0.5): void { this.cur += `${gray} G ${w} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`; }
  rect(x: number, y: number, w: number, h: number, color: [number, number, number]): void { this.cur += `${color[0]} ${color[1]} ${color[2]} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`; }
  /** Wrap text to a width; returns the lines. */
  wrap(s: string, width: number, size: number, bold = false): string[] {
    const out: string[] = []; let line = '';
    for (const word of latin(s).split(/\s+/)) { const next = line ? line + ' ' + word : word; if (line && textWidth(next, size, bold) > width) { out.push(line); line = word; } else line = next; }
    if (line) out.push(line); return out;
  }
  /** A paragraph at the current position; moves `y` down. */
  paragraph(s: string, o: PdfText & { width?: number; gap?: number } = {}): void {
    const size = o.size ?? 10, lines = this.wrap(s, o.width ?? this.width - 2 * this.margin, size, o.bold);
    for (const l of lines) { this.room(size * 1.4); this.text(this.margin, this.y - size, l, o); this.y -= size * 1.4; }
    this.y -= o.gap ?? 4;
  }
  /** A table with a header row; column widths are fractions of the text width. */
  table(head: string[], rows: string[][], widths: number[], o: { size?: number; align?: ('left' | 'right')[]; mark?: (row: string[]) => [number, number, number] | null } = {}): void {
    const size = o.size ?? 8.5, full = this.width - 2 * this.margin, xs: number[] = []; let x = this.margin; for (const w of widths) { xs.push(x); x += w * full; }
    const draw = (cells: string[], bold: boolean, color?: [number, number, number] | null) => {
      const wrapped = cells.map((c, i) => this.wrap(c, widths[i] * full - 6, size, bold)), h = Math.max(1, ...wrapped.map(w => w.length)) * size * 1.3 + 4;
      this.room(h);
      if (bold) this.rect(this.margin, this.y - h, full, h, [0.93, 0.94, 0.96]);
      wrapped.forEach((ls, i) => ls.forEach((l, k) => { const right = o.align?.[i] === 'right'; this.text(right ? xs[i] + widths[i] * full - 3 : xs[i] + 3, this.y - size - 1 - k * size * 1.3, l, { size, bold, align: right ? 'right' : 'left', color: i === cells.length - 1 && color ? color : undefined }); }));
      this.y -= h; this.line(this.margin, this.y, this.margin + full, this.y, 0.86, 0.4);
    };
    draw(head, true);
    for (const r of rows) draw(r, false, o.mark?.(r));
    this.y -= 8;
  }
  /** The finished document as bytes. */
  build(info: { title: string; author?: string }): Uint8Array {
    const pages = [...this.pages, this.cur], objs: string[] = [], n = pages.length;
    const pageIds = pages.map((_, i) => 5 + 2 * i);
    objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objs[2] = `<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(' ')}] /Count ${n} >>`;
    objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
    objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
    pages.forEach((content, i) => {
      const footer = `BT /F1 8 Tf 0.45 0.48 0.53 rg ${this.margin} 28 Td (${esc(info.title)}) Tj ET\nBT /F1 8 Tf 0.45 0.48 0.53 rg ${(this.width - this.margin - 50).toFixed(2)} 28 Td (Page ${i + 1} of ${n}) Tj ET\n`, body = content + footer;
      objs[5 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`;
      objs[6 + 2 * i] = `<< /Length ${body.length} >>\nstream\n${body}endstream`;
    });
    const infoId = 5 + 2 * n; objs[infoId] = `<< /Title (${esc(info.title)}) /Author (${esc(info.author ?? 'Nodal')}) /Creator (Nodal) >>`;
    let out = '%PDF-1.4\n%âãÏÓ\n'; const offsets: number[] = [];
    for (let i = 1; i < objs.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
    const xref = out.length; out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255; return bytes;
  }
}
