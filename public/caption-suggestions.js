// Local caption ideas only: choosing one never creates artwork or calls an API.
export function attachCaptionSuggestions({ top, bottom, button, status, onChange = () => {} }) {
  const fields = [top, bottom];
  let template = null, next = 0, suggested = [null, null], applying = false;
  const canFill = (field, side) => !field.value.trim() || (suggested[side] !== null && field.value === suggested[side]);
  function fill() {
    if (button.disabled || !template?.captionSuggestions?.length || fields.some(field => field.disabled)) return false;
    const available = fields.map(canFill);
    if (!available.some(Boolean)) { status.textContent = 'Your own captions are kept. Clear a box to use a suggestion.'; return false; }
    const ideas = template.captionSuggestions, idea = ideas[next % ideas.length];
    applying = true;
    try {
      for (const [side, field] of fields.entries()) {
        if (!available[side]) continue;
        field.value = side === 0 ? idea.top : idea.bottom; suggested[side] = field.value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } finally { applying = false; }
    next = (next + 1) % ideas.length;
    onChange();
    status.textContent = `Caption idea ${((next + ideas.length - 1) % ideas.length) + 1} of ${ideas.length} for ${template.name}. Edit it, or tap Suggest captions for another idea.${available.every(Boolean) ? '' : ' Your own text was kept.'}`;
    return true;
  }
  button.addEventListener('click', fill);
  fields.forEach((field, side) => {
    field.addEventListener('input', () => { if (!applying) suggested[side] = null; });
    field.addEventListener('keydown', event => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat || field.disabled || button.disabled || field.value.trim()) return;
      if (event.key === 'Tab') fill(); // Keep normal forward focus navigation; never trap Tab.
      else if (event.key === ' ' || event.key === 'Spacebar') { if (fill()) event.preventDefault(); }
    });
    field.addEventListener('beforeinput', event => {
      // Phone keyboards may send beforeinput without a keydown event.
      if (event.isComposing || !event.cancelable || event.inputType !== 'insertText' || event.data !== ' ' || field.disabled || button.disabled || field.value.trim()) return;
      if (fill()) event.preventDefault();
    });
  });
  return {
    select(nextTemplate) {
      if (template?.id === nextTemplate.id) return;
      applying = true;
      try { for (const [side, field] of fields.entries()) if (suggested[side] !== null && field.value === suggested[side]) { field.value = ''; field.dispatchEvent(new Event('input', { bubbles: true })); } }
      finally { applying = false; }
      template = nextTemplate; next = 0; suggested = [null, null];
      const first = template.captionSuggestions?.[0];
      top.placeholder = first?.top || 'Your top caption'; bottom.placeholder = first?.bottom || 'Your bottom caption';
      status.textContent = first ? `${template.captionSuggestions.length} caption ideas for ${template.name}. Tap Suggest captions, or use Tab / Space in an empty caption box.` : 'Caption suggestions are unavailable for this template.';
      onChange();
    },
  };
}
