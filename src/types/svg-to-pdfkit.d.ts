declare module "svg-to-pdfkit" {
  interface Options {
    width?: number; height?: number; preserveAspectRatio?: string; assumePt?: boolean; useCSS?: boolean; precision?: number;
    warningCallback?(msg: string): void;
    fontCallback?(family: string, bold: boolean, italic: boolean, fontOptions?: unknown): string;
    colorCallback?(c: unknown): unknown;
  }
  export default function SVGtoPDF(doc: PDFKit.PDFDocument, svg: string, x?: number, y?: number, options?: Options): void;
}
