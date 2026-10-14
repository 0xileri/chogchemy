// Local caption ideas only: choosing one never creates artwork or calls an API.
export function attachCaptionSuggestions({ top, bottom, fields: suppliedFields, button, status, onChange = () => {} }) {
  const fields = suppliedFields || [top, bottom];
  let template = null, next = 0, suggested = fields.map(() => null), applying = false;
  const slots = () => template?.captionSlots || template?.layout?.boxes || [];
  const activeFields = () => fields.slice(0, slots().length || 2);
  const ideas = () => template?.slotCaptionSuggestions?.length
    ? template.slotCaptionSuggestions.map(idea => slots().map(slot => idea.find(caption => caption.boxId === slot.id)?.text || ''))
    : (template?.captionSuggestions || []).map(idea => [idea.top, idea.bottom]);
  const canFill = (field, side) => !field.value.trim() || (suggested[side] !== null && field.value === suggested[side]);
  function fill() {
    const choices = ideas(), active = activeFields();
    if (button.disabled || !choices.length || active.some(field => field.disabled)) return false;
    const available = active.map(canFill);
    if (!available.some(Boolean)) { status.textContent = 'Your own captions are kept. Clear a box to use a suggestion.'; return false; }
    const idea = choices[next % choices.length];
    applying = true;
    try {
      for (const [side, field] of active.entries()) {
        if (!available[side]) continue;
        field.value = idea[side] || ''; suggested[side] = field.value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } finally { applying = false; }
    next = (next + 1) % choices.length;
    onChange();
    status.textContent = `Caption idea ${((next + choices.length - 1) % choices.length) + 1} of ${choices.length} for ${template.name}. Edit it, or tap Suggest captions for another idea.${available.every(Boolean) ? '' : ' Your own text was kept.'}`;
    return true;
  }
  button.addEventListener('click', fill);
  fields.forEach((field, side) => {
    field.addEventListener('input', () => { if (!applying) suggested[side] = null; });
    field.addEventListener('keydown', event => {
      if (side >= activeFields().length || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat || field.disabled || button.disabled || field.value.trim()) return;
      if (event.key === 'Tab') fill(); // Keep normal forward focus navigation; never trap Tab.
      else if (event.key === ' ' || event.key === 'Spacebar') { if (fill()) event.preventDefault(); }
    });
    field.addEventListener('beforeinput', event => {
      // Phone keyboards may send beforeinput without a keydown event.
      if (side >= activeFields().length || event.isComposing || !event.cancelable || event.inputType !== 'insertText' || event.data !== ' ' || field.disabled || button.disabled || field.value.trim()) return;
      if (fill()) event.preventDefault();
    });
  });
  return {
    select(nextTemplate) {
      if (template?.id === nextTemplate.id) return;
      applying = true;
      try { for (const [side, field] of fields.entries()) if (suggested[side] !== null && field.value === suggested[side]) { field.value = ''; field.dispatchEvent(new Event('input', { bubbles: true })); } }
      finally { applying = false; }
      template = nextTemplate; next = 0; suggested = fields.map(() => null);
      const choices = ideas(), first = choices[0];
      activeFields().forEach((field, index) => { field.placeholder = first?.[index] || slots()[index]?.label || (index === 0 ? 'Your top caption' : 'Your bottom caption'); });
      status.textContent = first ? `${choices.length} caption ideas for ${template.name}. Tap Suggest captions, or use Tab / Space in an empty caption box.` : 'Caption suggestions are unavailable for this template.';
      onChange();
    },
  };
}
