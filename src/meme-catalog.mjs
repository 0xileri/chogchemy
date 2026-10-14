import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { digest, imageMime } from './art-direction.mjs';
import { limitedBytes } from './reference-assets.mjs';

export const memeCatalog = JSON.parse(readFileSync(new URL('../assets/memes/catalog.json', import.meta.url), 'utf8'));
const captionIdeas = JSON.parse(readFileSync(new URL('../assets/memes/caption-ideas.json', import.meta.url), 'utf8'));
if (memeCatalog.templates.length !== 100 || new Set(memeCatalog.templates.map(t => t.id)).size !== 100) throw new Error('Invalid meme catalog.');
for (const template of memeCatalog.templates) {
  if (!/^\d+$/.test(template.id) || !/^https:\/\/i\.imgflip\.com\/[a-z0-9]+\.(jpg|png)$/.test(template.imageUrl)) throw new Error('Invalid catalog image.');
  const ideas = captionIdeas[template.id];
  if (!Array.isArray(ideas) || ideas.length < 2 || ideas.some(idea => !idea || ['top', 'bottom'].some(key => typeof idea[key] !== 'string' || !idea[key].trim() || idea[key].length > 80 || /[\u0000-\u001f\u007f]/.test(idea[key])))) throw new Error('Invalid caption suggestions.');
  template.captionSuggestions = ideas;
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
function lines(text) {
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
export async function captionMeme(bytes, top, bottom, fixture = false) {
  // Draw user captions locally so model spelling doesn't control the final joke.
  const captions = [top, bottom].map(text => text ? lines(text) : []);
  if (!top && !bottom && !fixture) return sharp(bytes, { limitInputPixels: 16777216 }).png().toBuffer();
  const heights = captions.map(items => items.length ? 28 + items.length * 48 : 0);
  const size = 1024, imageHeight = size - heights[0] - heights[1] - (fixture ? 36 : 0);
  const picture = await sharp(bytes, { limitInputPixels: 16777216 }).resize(size, imageHeight, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
  const text = captions.flatMap((items, side) => items.map((line, i) => `<text x="512" y="${(side ? heights[0] + imageHeight : 0) + 54 + i * 48}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="40" font-weight="bold" fill="#243024">${escape(line)}</text>`)).join('');
  const label = fixture ? '<text x="512" y="1013" text-anchor="middle" font-family="DejaVu Sans" font-size="18" fill="#243024">TEST MEME · Synthetic artwork, not AI output</text>' : '';
  return sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } }).composite([{ input: picture, top: heights[0], left: 0 }, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${text}${label}</svg>`), top: 0, left: 0 }]).png().toBuffer();
}
