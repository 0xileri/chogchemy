export async function shareOrCopy(url, title) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return 'shared'; }
    catch (error) { if (error.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(url); return 'copied'; }
  catch { return 'manual'; }
}
