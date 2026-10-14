export async function shareOrCopy(value, title) {
  const data = typeof value === 'string' ? { url: value, title } : { url: value?.url, title: value?.title, text: value?.text };
  if (typeof data.url !== 'string' || !/^https?:\/\//.test(data.url)) throw new Error('A public page link is required for sharing.');
  if (navigator.share) {
    try { await navigator.share(data); return 'shared'; }
    catch (error) { if (error.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(data.url); return 'copied'; }
  catch { return 'manual'; }
}
