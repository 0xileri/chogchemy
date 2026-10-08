// Original procedural PNGs for the isolated browser fixture, not official Chog art.
import { deflateSync } from 'node:zlib';
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const payload = Buffer.concat([name, data]); let crc = 0xffffffff;
  for (const byte of payload) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}
export function fixtureArt(pink = false) {
  const size = 256, rows = Buffer.alloc((size * 3 + 1) * size);
  const ellipse = (x, y, cx, cy, rx, ry) => ((x-cx)/rx)**2 + ((y-cy)/ry)**2 < 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let color = [247, 246, 237];
    if (ellipse(x,y,128,151,83,79) || ellipse(x,y,69,75,23,45) || ellipse(x,y,187,75,23,45)) color = pink ? [222, 151, 168] : [124, 164, 104];
    if (ellipse(x,y,98,139,14,20) || ellipse(x,y,158,139,14,20)) color = [252, 252, 242];
    if (ellipse(x,y,100,143,6,10) || ellipse(x,y,156,143,6,10)) color = [36, 48, 36];
    if (ellipse(x,y,128,178,15,7)) color = [36, 48, 36];
    const offset = y*(size*3+1)+1+x*3; rows[offset]=color[0]; rows[offset+1]=color[1]; rows[offset+2]=color[2];
  }
  const header=Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8; header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
