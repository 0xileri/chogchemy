import sharp from 'sharp';

export const stickerReactions = Object.freeze([
  { id: 'gm', name: 'GM', caption: 'GM!', pose: 'The saved child cheerfully waves good morning while holding a little mug.' },
  { id: 'crying', name: 'Crying', caption: 'WAAAH!', pose: 'The saved child cries exaggerated cartoon tears with a dramatically sad expression.' },
  { id: 'celebrating', name: 'Celebrating', caption: "LET'S GO!", pose: 'Both parents and their saved child throw their hands up in celebration with a little confetti.' },
  { id: 'hugs', name: 'Hugs', caption: 'BIG HUG', pose: 'Both parents and their saved child squeeze together in a warm family hug.' },
  { id: 'sleepy', name: 'Sleepy', caption: 'ZZZ...', pose: 'The saved child is peacefully asleep on a little pillow with a sleepy smile.' },
  { id: 'send-help', name: 'Send help', caption: 'SEND HELP', pose: 'The saved child looks comically overwhelmed while both playful parents lean in from either side.' },
]);

// Remove only neutral near-white background connected to a tile's edge.
// Enclosed whites (eyes, teeth, clothes) remain part of the drawing.
export function cutBackground(input, width, height) {
  const data = Buffer.from(input), visited = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  const add = i => {
    if (visited[i]) return;
    visited[i] = 1;
    const p = i * 4, min = Math.min(data[p], data[p + 1], data[p + 2]), max = Math.max(data[p], data[p + 1], data[p + 2]);
    if (data[p + 3] === 0 || (min >= 240 && max - min <= 12)) { queue[tail++] = i; data[p + 3] = 0; }
  };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (x) add(i - 1); if (x + 1 < width) add(i + 1); if (y) add(i - width); if (y + 1 < height) add(i + width);
  }
  let left = width, top = height, right = -1, bottom = -1, visible = 0;
  for (let i = 0; i < width * height; i++) if (data[i * 4 + 3]) {
    visible++; const x = i % width, y = Math.floor(i / width);
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (visible < 100 || tail < width + height) throw new Error('The sticker sheet did not have usable isolated reactions.');
  return { data, bounds: { left, top, width: right - left + 1, height: bottom - top + 1 } };
}

function outline(data, width, height) {
  const pad = 5, w = width + pad * 2, h = height + pad * 2, output = Buffer.alloc(w * h * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3]; if (!alpha) continue;
    for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++) {
      if (dx * dx + dy * dy > pad * pad) continue;
      const p = ((y + pad + dy) * w + x + pad + dx) * 4;
      output[p] = output[p + 1] = output[p + 2] = 255; output[p + 3] = Math.max(output[p + 3], alpha);
    }
  }
  return { data: output, width: w, height: h, pad };
}

const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export function crc32(bytes) { let n = 0xffffffff; for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
export function zipFiles(files) {
  const bodies = [], directory = []; let offset = 0;
  for (const [name, bytes] of Object.entries(files)) {
    if (!/^[a-z0-9_.-]+$/i.test(name)) throw new Error('Invalid pack filename.');
    const filename = Buffer.from(name), crc = crc32(bytes), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    bodies.push(local, filename, bytes); directory.push(central, filename); offset += local.length + filename.length + bytes.length;
  }
  const size = directory.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22), count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, ...directory, end]);
}

export async function createStickerAssets(sheet, { fixture = false } = {}) {
  const source = sharp(sheet, { limitInputPixels: 16777216 }), metadata = await source.metadata();
  if (metadata.format !== 'png' || metadata.width !== metadata.height || metadata.width < 512) throw new Error('Invalid sticker sheet.');
  const normalized = await source.resize(1024, 1024).ensureAlpha().png().toBuffer(), assets = {};
  for (const [i, reaction] of stickerReactions.entries()) {
    const row = Math.floor(i / 2), top = Math.floor(row * 1024 / 3), bottom = Math.floor((row + 1) * 1024 / 3);
    const tile = await sharp(normalized).extract({ left: i % 2 * 512, top, width: 512, height: bottom - top }).ensureAlpha().raw().toBuffer();
    const cut = cutBackground(tile, 512, bottom - top);
    const resized = await sharp(cut.data, { raw: { width: 512, height: bottom - top, channels: 4 } }).extract(cut.bounds).resize({ width: 432, height: 350, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const border = outline(resized.data, resized.info.width, resized.info.height);
    const ink = await sharp(resized.data, { raw: { width: resized.info.width, height: resized.info.height, channels: 4 } }).png().toBuffer();
    const white = await sharp(border.data, { raw: { width: border.width, height: border.height, channels: 4 } }).png().toBuffer();
    const text = reaction.caption.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    const caption = Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect x="35" y="407" width="442" height="82" rx="41" fill="${i % 2 ? '#eab0c2' : '#d6f279'}" stroke="#243125" stroke-width="6"/><text x="256" y="462" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="40" fill="#243125">${text}</text>${fixture ? '<text x="256" y="505" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" fill="#243125">TEST STICKER · Synthetic artwork</text>' : ''}</svg>`);
    const left = Math.floor((512 - border.width) / 2), y = Math.floor((392 - border.height) / 2);
    assets[reaction.id] = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#00000000' } }).composite([{ input: white, left, top: y }, { input: ink, left: left + border.pad, top: y + border.pad }, { input: caption, left: 0, top: 0 }]).png().toBuffer();
  }
  const files = Object.fromEntries(stickerReactions.map((r, i) => [`0${i + 1}-${r.id}.png`, assets[r.id]]));
  files['README.txt'] = Buffer.from(`Chogchemy family sticker pack\r\n\r\nSix transparent 512 x 512 PNG images.\r\nUse a supported sticker creation/import tool in your chat app to add them as stickers, or share the PNG images. The ZIP is a download bundle, not an automatic chat-app installation.\r\n\r\n${fixture ? 'TEST STICKERS: synthetic artwork, not real Chog or AI art.' : 'AI-generated artwork using your saved Chog family and an artist style reference.'}\r\nArtist reference and art direction: @theejhay01. Builder: @0xileri.\r\nOriginal NFTs stay in their wallets; these images are not minted NFTs.\r\nhttps://chogchemy.up.railway.app\r\n`);
  assets.zip = zipFiles(files);
  return assets;
}
