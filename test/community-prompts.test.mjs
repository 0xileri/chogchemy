import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentCommunityPrompt, isCurrentCommunityPrompt, communityPromptById } from '../src/community-prompts.mjs';

test('community prompts change at Monday midnight UTC, not at a local midnight', () => {
  const before = Date.UTC(2026, 9, 18, 23, 59, 59, 999), boundary = before + 1;
  const old = currentCommunityPrompt(before), next = currentCommunityPrompt(boundary);
  assert.equal(old.id, 'chog-week-2026-10-12');
  assert.equal(next.id, 'chog-week-2026-10-19');
  assert.equal(old.endsAt, next.weekStart);
  assert.equal(old.endsAt - old.weekStart, 7 * 86400000);
  assert.notEqual(old.title, next.title);
  assert.equal(currentCommunityPrompt(new Date('2026-10-19T00:30:00+01:00')).id, old.id);
});

test('prompt IDs round-trip across month and year boundaries and reject rolled dates', () => {
  for (const time of [Date.UTC(2026, 9, 5), Date.UTC(2026, 11, 31), Date.UTC(2027, 0, 4), Date.UTC(2027, 1, 1)]) {
    const prompt = currentCommunityPrompt(time);
    assert.deepEqual(communityPromptById(prompt.id), prompt);
    assert.ok(isCurrentCommunityPrompt(prompt.id, time));
    assert.equal(communityPromptById(prompt.id).weekStart % 86400000, 0);
  }
  for (const id of [null, {}, 'chog-week-2026-02-30', 'chog-week-2026-10-14', 'chog-week-2026-13-12', 'chog-week-2026-10-12<script>', 'other-2026-10-12']) assert.equal(communityPromptById(id), null);
  assert.equal(isCurrentCommunityPrompt('chog-week-2026-10-05', Date.UTC(2026, 9, 14)), false);
  assert.throws(() => currentCommunityPrompt(NaN), TypeError);
});

test('public prompt metadata has no fabricated votes or winners and is isolated from mutation', () => {
  const now = Date.UTC(2026, 9, 14), prompt = currentCommunityPrompt(now), copy = currentCommunityPrompt(now);
  prompt.captionExamples[0].top = 'Changed outside the module';
  assert.deepEqual(currentCommunityPrompt(now), copy);
  assert.doesNotMatch(JSON.stringify(copy), /"(?:votes|likes|winner|participants)":/);
  for (const idea of copy.captionExamples) for (const text of [idea.top, idea.bottom]) assert.ok(text.length > 0 && text.length <= 80);
});
