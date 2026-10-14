import { readFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { digest, imageMime } from './art-direction.mjs';
import { limitedBytes } from './reference-assets.mjs';

export const memeCatalog = JSON.parse(readFileSync(new URL('../assets/memes/catalog.json', import.meta.url), 'utf8'));
const captionIdeas = JSON.parse(readFileSync(new URL('../assets/memes/caption-ideas.json', import.meta.url), 'utf8'));
export const memeLayouts = JSON.parse(readFileSync(new URL('../assets/memes/layouts.json', import.meta.url), 'utf8'));
const platformFont = process.platform === 'win32'
  ? { family: 'Arial', file: 'C:/Windows/Fonts/arialbd.ttf' }
  : { family: 'DejaVu Sans', file: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' };
// Use installed OS fonts directly. No proprietary font files are bundled.
const captionFont = existsSync(platformFont.file) ? platformFont : { family: 'sans-serif', file: undefined };
if (memeCatalog.templates.length !== 100 || new Set(memeCatalog.templates.map(t => t.id)).size !== 100) throw new Error('Invalid meme catalog.');
for (const template of memeCatalog.templates) {
  if (!/^\d+$/.test(template.id) || !/^https:\/\/i\.imgflip\.com\/[a-z0-9]+\.(jpg|png)$/.test(template.imageUrl)) throw new Error('Invalid catalog image.');
  const ideas = captionIdeas[template.id];
  if (!Array.isArray(ideas) || ideas.length < 2 || ideas.some(idea => !idea || ['top', 'bottom'].some(key => typeof idea[key] !== 'string' || !idea[key].trim() || idea[key].length > 80 || /[\u0000-\u001f\u007f]/.test(idea[key])))) throw new Error('Invalid caption suggestions.');
  template.captionSuggestions = ideas;
  const layout = memeLayouts.templates[template.id];
  if (layout) {
    if (layout.category !== undefined) {
      if (!['Reactions', 'Choices', 'Conversations', 'Situations'].includes(layout.category)) throw new Error('Invalid curated meme category.');
      template.category = layout.category;
    }
    if (!Array.isArray(layout.boxes) || layout.boxes.length < 2 || layout.boxes.length > 4 || new Set(layout.boxes.map(box => box.id)).size !== layout.boxes.length || layout.boxes.some(box => !/^[a-z0-9-]+$/.test(box.id) || typeof box.label !== 'string' || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(box[key]) || box[key] < 0 || box[key] > 1) || box.width <= 0 || box.height <= 0 || box.x + box.width > 1 || box.y + box.height > 1)) throw new Error('Invalid caption layout.');
    template.layout = { version: memeLayouts.version, roles: layout.roles, boxes: layout.boxes };
    template.captionSlots = layout.boxes;
    template.rolePresets = layout.roles;
    template.recommendedOrder = layout.recommendedOrder;
    if (!Array.isArray(layout.captionIdeas) || layout.captionIdeas.length < 2 || layout.captionIdeas.some(idea => idea.length !== layout.boxes.length || idea.some((caption, index) => caption.boxId !== layout.boxes[index].id || typeof caption.text !== 'string' || !caption.text.trim() || caption.text.length > 80 || /[\u0000-\u001f\u007f]/.test(caption.text)))) throw new Error('Invalid complete caption ideas.');
    template.slotCaptionSuggestions = layout.captionIdeas;
  }
}
export const memeTemplate = id => memeCatalog.templates.find(t => t.id === id);
export async function loadMemeTemplate(template, fetcher = fetch) {
  // Only fetch the fixed catalog URL. Clients cannot supply URLs or redirects.
  const known = memeTemplate(template.id);
  if (!known || known.imageUrl !== template.imageUrl) throw new Error('Unknown meme template.');
  const response = await fetcher(known.imageUrl, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Meme template is temporarily unavailable.');
  const bytes = await limitedBytes(response, 8 * 1024 * 1024);
  const mime = imageMime(bytes);
  const metadata = await sharp(bytes, { limitInputPixels: 16777216 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Invalid meme template image.');
  return { bytes, mime, digest: digest(bytes), templateId: known.id, name: known.name };
}

const escape = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Used only to recover the scene area in PNGs saved before editable scenes existed.
function legacyLines(text) {
  const result = [], words = text.split(/\s+/); let line = '';
  for (const word of words) {
    const characters = [...word];
    if (characters.length > 32) { if (line) { result.push(line); line = ''; } for (let i = 0; i < characters.length; i += 32) result.push(characters.slice(i, i + 32).join('')); }
    else if ([...(line + ' ' + word).trim()].length > 32) { result.push(line); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) result.push(line);
  return result;
}
export function normalizeMemeCaptions(value, template) {
  if (!Array.isArray(value) || !template?.layout || value.length > template.layout.boxes.length) throw new Error('Choose valid caption boxes for this template.');
  const supplied = new Map();
  for (const item of value) {
    if (!item || typeof item.boxId !== 'string' || supplied.has(item.boxId) || !template.layout.boxes.some(box => box.id === item.boxId) || typeof item.text !== 'string' || item.text.length > 80 || /[\u0000-\u001f\u007f]/.test(item.text)) throw new Error('Keep each caption to 80 characters and use this template’s caption boxes.');
    supplied.set(item.boxId, item.text.trim());
  }
  return template.layout.boxes.map(box => ({ boxId: box.id, text: supplied.get(box.id) || '' }));
}

export async function renderCaptionText(text, width, height, fontSize = 40) {
  // Pango measures glyphs and wraps long words in pixels. Escape all markup first.
  // See https://sharp.pixelplumbing.com/api-constructor/#text and Pango markup docs.
  const rendered = await sharp({ text: { text: `<span foreground="#243024">${escape(text)}</span>`, font: `${captionFont.family} Bold ${fontSize}`, ...(captionFont.file ? { fontfile: captionFont.file } : {}), width, wrap: 'word-char', align: 'center', rgba: true, dpi: 72 } }).png().toBuffer({ resolveWithObject: true });
  if (rendered.info.width <= width && rendered.info.height <= height) return rendered;
  return sharp(rendered.data).resize({ width, height, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
}

async function textLayer(text, rectangle, fontSize = 40, background = true) {
  const padding = 12, width = Math.max(1, rectangle.width - padding * 2), height = Math.max(1, rectangle.height - padding * 2);
  const rendered = await renderCaptionText(text, width, height, fontSize);
  const layers = [];
  if (background) layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${rectangle.width}" height="${rectangle.height}"><rect width="100%" height="100%" rx="12" fill="white" fill-opacity="0.94"/></svg>`), left: rectangle.left, top: rectangle.top });
  layers.push({ input: rendered.data, left: rectangle.left + Math.floor((rectangle.width - rendered.info.width) / 2), top: rectangle.top + Math.floor((rectangle.height - rendered.info.height) / 2) });
  return layers;
}

export async function captionMeme(bytes, top = '', bottom = '', fixture = false, options = {}) {
  const size = 1024, markerHeight = fixture ? 36 : 0, layers = [];
  if (Array.isArray(options.captions) && options.template?.layout) {
    const captions = normalizeMemeCaptions(options.captions, options.template);
    const pictureHeight = size - markerHeight;
    const picture = await sharp(bytes, { limitInputPixels: 16777216 }).resize(size, pictureHeight, { fit: 'fill' }).png().toBuffer();
    layers.push({ input: picture, left: 0, top: 0 });
    for (const item of captions) {
      if (!item.text) continue;
      const box = options.template.layout.boxes.find(box => box.id === item.boxId);
      const rectangle = { left: Math.round(box.x * size), top: Math.round(box.y * pictureHeight), width: Math.round(box.width * size), height: Math.round(box.height * pictureHeight) };
      rectangle.width = Math.min(rectangle.width, size - rectangle.left); rectangle.height = Math.min(rectangle.height, pictureHeight - rectangle.top);
      layers.push(...await textLayer(item.text, rectangle, box.fontSize || 40));
    }
  } else {
    if (!top && !bottom && !fixture) return sharp(bytes, { limitInputPixels: 16777216 }).png().toBuffer();
    const captions = [top, bottom], heights = [];
    for (const text of captions) {
      if (!text) { heights.push(0); continue; }
      const rendered = await renderCaptionText(text, size - 48, 180);
      heights.push(rendered.info.height + 32);
    }
    const imageHeight = size - heights[0] - heights[1] - markerHeight;
    const picture = await sharp(bytes, { limitInputPixels: 16777216 }).resize(size, imageHeight, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
    layers.push({ input: picture, left: 0, top: heights[0] });
    if (top) layers.push(...await textLayer(top, { left: 12, top: 0, width: size - 24, height: heights[0] }, 40, false));
    if (bottom) layers.push(...await textLayer(bottom, { left: 12, top: heights[0] + imageHeight, width: size - 24, height: heights[1] }, 40, false));
  }
  if (fixture) layers.push(...await textLayer('TEST MEME · Synthetic artwork, not AI output', { left: 0, top: size - markerHeight, width: size, height: markerHeight }, 18, false));
  return sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } }).composite(layers).png().toBuffer();
}

export async function restoreLegacyMemeScene(bytes, record) {
  const top = record.topCaption || '', bottom = record.bottomCaption || '', fixture = record.artwork?.mode === 'fixture';
  if ([top, bottom].some(text => typeof text !== 'string' || text.length > 80 || /[\u0000-\u001f\u007f]/.test(text))) throw new Error('This older image has no recoverable caption-free scene. Its original download is still available.');
  if (!top && !bottom && !fixture) return { bytes: Buffer.from(bytes), source: 'legacy_uncaptioned' };
  const meta = await sharp(bytes, { limitInputPixels: 16777216 }).metadata();
  if (meta.width !== 1024 || meta.height !== 1024) throw new Error('This older image has an unknown caption layout. Its original download is still available.');
  const heights = [top, bottom].map(text => text ? 28 + legacyLines(text).length * 48 : 0);
  const imageHeight = 1024 - heights[0] - heights[1] - (fixture ? 36 : 0);
  // Original providers requested square scenes. The legacy compositor fitted that
  // scene inside a 1024 × imageHeight rectangle, centred on a white background.
  const scene = await sharp(bytes, { limitInputPixels: 16777216 }).extract({ left: Math.floor((1024 - imageHeight) / 2), top: heights[0], width: imageHeight, height: imageHeight }).resize(1024, 1024).png().toBuffer();
  return { bytes: scene, source: 'legacy_crop' };
}
