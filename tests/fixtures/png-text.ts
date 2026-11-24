import { crc32, deflateSync } from "node:zlib";

/** A real 1×1 PNG carrying `text` in a `tEXt` chunk under `key`: what fake mode's image reader returns (src/server/assistant/readImage.ts). */
export function pngWithText(text: string, key = "ocr"): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.concat([Buffer.from(key, "latin1"), Buffer.from([0]), Buffer.from(text, "utf8")])),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 255, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
