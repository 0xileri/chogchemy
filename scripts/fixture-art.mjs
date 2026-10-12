// Original procedural PNGs for the isolated browser fixture, not official Chog art.
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';

// Original geometric reactions for sticker pipeline/UI tests, not Chog or AI art.
export async function fixtureStickerSheet() {
  const colors = ['#d6f279', '#eab0c2', '#8fc6db', '#dea67b', '#b6a0d4', '#efc66f'];
  const drawings = colors.map((color, i) => {
    const x = i % 2 * 512 + 256, y = Math.floor(i / 2) * 1024 / 3 + 160;
    return `<g><ellipse cx="${x}" cy="${y}" rx="120" ry="110" fill="${color}" stroke="#243125" stroke-width="9"/><circle cx="${x - 40}" cy="${y - 20}" r="25" fill="white" stroke="#243125" stroke-width="8"/><circle cx="${x + 40}" cy="${y - 20}" r="25" fill="white" stroke="#243125" stroke-width="8"/><path d="M${x - 25},${y + 40}Q${x},${y + 65} ${x + 25},${y + 40}" fill="none" stroke="#243125" stroke-width="9"/></g>`;
  }).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="white"/>${drawings}</svg>`)).png().toBuffer();
}
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

// Three panels of original placeholder shapes for UI testing only, not an AI comic.
export function fixtureComic() {
  const size = 768, rows = Buffer.alloc((size * 3 + 1) * size);
  const ellipse = (x, y, cx, cy, rx, ry) => ((x-cx)/rx)**2 + ((y-cy)/ry)**2 < 1;
  function chog(x, y, cx, cy, scale, color) {
    const px = (x-cx)/scale, py = (y-cy)/scale;
    if (ellipse(px,py,0,0,65,57) || ellipse(px,py,-42,-53,18,34) || ellipse(px,py,42,-53,18,34)) {
      if (ellipse(px,py,-24,-8,12,15) || ellipse(px,py,24,-8,12,15)) {
        if (ellipse(px,py,-22,-6,5,9) || ellipse(px,py,22,-6,5,9)) return [36,48,36];
        return [247,246,237];
      }
      if (ellipse(px,py,0,25,12,5)) return [36,48,36];
      return color;
    }
    return null;
  }
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const panel = Math.floor(y/256), py = y%256;
    let color = panel === 0 ? [239,243,220] : panel === 1 ? [249,235,222] : [230,241,222];
    if (x<8 || x>759 || py<8 || py>247) color=[36,48,36];
    else {
      if (panel===0 && Math.abs(((x-384)/295)**2+((py-177)/168)**2-1)<.065 && py<177) color=[229,163,183];
      if (panel===2 && py>205 && x>190 && x<580) color=[229,163,183];
      color = chog(x,py,260,160,1,[124,164,104]) || chog(x,py,508,160,1,[222,151,168]) || (panel>0 ? chog(x,py,384,190,.58,[217,218,123]) : null) || color;
    }
    const offset=y*(size*3+1)+1+x*3; rows[offset]=color[0]; rows[offset+1]=color[1]; rows[offset+2]=color[2];
  }
  const header=Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8; header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
