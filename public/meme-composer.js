// Shared form rules keep older saved memes and the curated layouts compatible.
export function captionSlots(template) {
  const slots = template?.captionSlots || template?.layout?.boxes;
  return Array.isArray(slots) && slots.length ? slots.slice(0, 4) : [];
}
export function captionDraft(template, values) {
  const slots = captionSlots(template);
  return slots.length
    ? { captions: slots.map((slot, index) => ({ boxId: slot.id, text: values[index] || '' })) }
    : { topCaption: values[0] || '', bottomCaption: values[1] || '' };
}
export function savedCaptionValues(record) {
  const slots = captionSlots(record?.template);
  return slots.length ? slots.map((slot, index) => record.captions?.find(caption => caption.boxId === slot.id)?.text
    ?? (record.captions?.length ? '' : index === 0 ? record.topCaption || '' : index === slots.length - 1 ? record.bottomCaption || '' : ''))
    : [record?.topCaption || '', record?.bottomCaption || ''];
}
export function roleDescription(template, id, custom = '') {
  if (custom.trim()) return custom.trim();
  return (template?.rolePresets || template?.layout?.roles || []).find(role => role.id === id)?.description || '';
}
export function filterTemplates(templates, { query = '', category = 'all', scope = 'recommended' } = {}) {
  const search = query.trim().toLowerCase();
  return templates.filter(template => (scope !== 'recommended' || Number.isInteger(template.recommendedOrder))
    && (!search || template.name.toLowerCase().includes(search)) && (category === 'all' || template.category === category))
    .sort((a, b) => scope === 'recommended' ? a.recommendedOrder - b.recommendedOrder : a.rank - b.rank);
}

export async function requestCaptionExport(path, body, { fetcher = fetch, onUnauthorized = () => {}, stillCurrent = () => true } = {}) {
  const response = await fetcher(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    if (response.status === 401) onUnauthorized();
    const error = new Error(detail.error || 'Could not export the captions. Your original is still saved.'); error.status = response.status;
    throw error;
  }
  if (!response.headers.get('Content-Type')?.startsWith('image/png')) throw new Error('The export did not return an image. Your original is still saved.');
  const blob = await response.blob();
  // Never display an earlier wallet’s export after account, session or record changes.
  return stillCurrent() ? blob : null;
}
