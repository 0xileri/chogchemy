const day = 86400000;
const week = day * 7;
const anchor = Date.UTC(2026, 9, 12); // Monday, 00:00 UTC.
const themes = [
  { title: 'When Monday finds your Chog', description: 'The alarm, the commute, or the first message from work. Put your Chog in a very relatable Monday.', captionExamples: [{ top: 'Me promising to wake up early', bottom: 'The alarm at 6 AM' }, { top: 'My first meeting of the week', bottom: 'My brain is still on Sunday' }] },
  { title: 'The group chat has entered the scene', description: 'One unread message becomes 200. Show how your Chog handles the group chat.', captionExamples: [{ top: 'I leave the group chat for five minutes', bottom: 'Everyone has already planned a holiday' }, { top: 'Me sending a perfectly normal message', bottom: 'My friends turning it into a meme' }] },
  { title: 'Your Chog versus the last slice', description: 'The last slice of pizza, a midnight snack, or the meal someone said they did not want. Let your Chog tell the food story.', captionExamples: [{ top: 'I said I was not hungry', bottom: 'Then the fries arrived' }, { top: 'Me sharing everything with my friends', bottom: 'Except the last slice' }] },
  { title: 'Five more minutes', description: 'Getting up, leaving the house, or one more episode. Your Chog knows those five minutes never stay five.', captionExamples: [{ top: 'I will be there in five minutes', bottom: 'I have not found my shoes' }, { top: 'One more episode before bed', bottom: 'The sun is coming up' }] },
  { title: 'The small win deserves a celebration', description: 'Found your keys, finished a task, or finally sent that message? Give your Chog a tiny victory with a big reaction.', captionExamples: [{ top: 'Finished the thing I avoided all week', bottom: 'It took six minutes' }, { top: 'Me finding my keys', bottom: 'In the first place I checked' }] },
  { title: 'That awkward moment', description: 'Waving at the wrong person or saying you too at the wrong time. Your Chog has been there.', captionExamples: [{ top: 'The waiter says enjoy your meal', bottom: 'My brain says you too' }, { top: 'Me waving back with confidence', bottom: 'They were waving at the person behind me' }] },
];

function timestamp(value) {
  const result = value instanceof Date ? value.getTime() : value;
  if (!Number.isSafeInteger(result) || !Number.isFinite(new Date(result).getTime())) throw new TypeError('Use a valid timestamp for the community prompt.');
  return result;
}

export function currentCommunityPrompt(value = Date.now()) {
  const time = timestamp(value), date = new Date(time);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const weekStart = midnight - ((date.getUTCDay() + 6) % 7) * day;
  const index = ((Math.floor((weekStart - anchor) / week) % themes.length) + themes.length) % themes.length;
  return { id: `chog-week-${new Date(weekStart).toISOString().slice(0, 10)}`, weekStart, endsAt: weekStart + week, ...structuredClone(themes[index]) };
}

export function isCurrentCommunityPrompt(id, value = Date.now()) {
  return typeof id === 'string' && id === currentCommunityPrompt(value).id;
}

export function communityPromptById(id) {
  if (typeof id !== 'string' || !/^chog-week-\d{4}-\d{2}-\d{2}$/.test(id)) return null;
  const value = Date.parse(id.slice(10) + 'T00:00:00.000Z');
  if (!Number.isFinite(value)) return null;
  const prompt = currentCommunityPrompt(value);
  return prompt.id === id ? prompt : null;
}
