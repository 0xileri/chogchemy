const parents = [
  { id: 'sample-001', name: 'Moss', color: '#8da866', trait: 'Forest green · Sleepy eyes' },
  { id: 'sample-002', name: 'Peach', color: '#edaa8c', trait: 'Peach pink · Curious eyes' },
  { id: 'sample-003', name: 'Orbit', color: '#a9a0ce', trait: 'Lavender · Star antenna' },
  { id: 'sample-004', name: 'Sunny', color: '#e9ca65', trait: 'Golden yellow · Rosy cheeks' }
];
const $ = (id) => document.getElementById(id);
function portrait(color, accent = color) {
  return `<svg viewBox="0 0 200 200" role="img" aria-label="Original placeholder creature, not official Chog artwork"><ellipse cx="100" cy="173" rx="65" ry="10" fill="#243024" opacity=".1"/><path d="M48 96 Q25 40 62 46 L80 69 Q100 57 120 69 L138 46 Q175 40 152 96 Q182 166 100 173 Q18 166 48 96" fill="${color}" stroke="#293a2a" stroke-width="3"/><ellipse cx="100" cy="143" rx="37" ry="23" fill="${accent}"/><ellipse cx="75" cy="108" rx="15" ry="19" fill="#faf9ee"/><ellipse cx="126" cy="108" rx="15" ry="19" fill="#faf9ee"/><circle cx="79" cy="111" r="6" fill="#293a2a"/><circle cx="122" cy="111" r="6" fill="#293a2a"/><path d="M90 134 Q100 143 111 133" fill="none" stroke="#293a2a" stroke-width="3" stroke-linecap="round"/></svg>`;
}
for (const key of ['a', 'b']) {
  for (const parent of parents) { const option = document.createElement('option'); option.value = parent.id; option.textContent = parent.name; $(`parent-${key}`).append(option); }
  $(`parent-${key}`).selectedIndex = key === 'a' ? 0 : 1;
  $(`parent-${key}`).addEventListener('change', renderParents);
}
function getParent(key) { return parents.find(p => p.id === $(`parent-${key}`).value); }
function renderParents() { for (const key of ['a', 'b']) { const p = getParent(key); $(`preview-${key}`).innerHTML = portrait(p.color); $(`traits-${key}`).textContent = p.trait; } }
let family = [];
try { const saved = JSON.parse(localStorage.getItem('chogchemy-demo-family') || '[]'); if (Array.isArray(saved)) family = saved.filter(x => typeof x.name === 'string' && parents.some(p => p.id === x.a) && parents.some(p => p.id === x.b)).slice(0, 50); } catch { /* Empty state if storage is unavailable or invalid. */ }
function renderFamily() {
  $('family').replaceChildren();
  if (!family.length) { const p = document.createElement('p'); p.className = 'empty-family'; p.textContent = 'No descendants yet. Make the first introduction in the lab.'; $('family').append(p); }
  for (const child of family) {
    const card = document.createElement('div'); card.className = 'family-card';
    const ancestry = document.createElement('span'); ancestry.textContent = `${parents.find(p => p.id === child.a).name} + ${parents.find(p => p.id === child.b).name} →`;
    const name = document.createElement('strong'); name.textContent = child.name;
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'Generation 1 · Demo';
    card.append(ancestry, name, badge); $('family').append(card);
  }
}
$('fuse').addEventListener('click', () => {
  const a = getParent('a'), b = getParent('b');
  if (a.id === b.id) { $('status').textContent = 'Choose two different parents to create a fusion.'; return; }
  const child = { a: a.id, b: b.id, name: `${a.name}${b.name.toLowerCase()}`, id: crypto.randomUUID() };
  $('result-art').innerHTML = portrait(a.color, b.color); $('result-art').classList.remove('empty');
  $('result-name').textContent = child.name; $('result-description').textContent = `A little ${a.name}. A little ${b.name}. Entirely its own thing.`;
  family.unshift(child); family = family.slice(0, 50);
  try { localStorage.setItem('chogchemy-demo-family', JSON.stringify(family)); $('status').textContent = 'Demo fusion created and saved locally. Artwork is a procedural placeholder, not AI output.'; } catch { $('status').textContent = 'Demo fusion created. Browser storage is unavailable; this result will not persist.'; }
  renderFamily();
});
renderParents(); renderFamily();
