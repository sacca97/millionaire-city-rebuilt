import { describe, expect, it } from 'vitest';
import { musicFor, parseFlag, soundForEvent } from './events';

describe('audio events', () => {
  it('maps events', () => {
    expect(soundForEvent('build_placed')).toBe('Build_Sound');
    expect(soundForEvent('collect_rent')).toBe('Income_Sound');
    expect(soundForEvent('level_up')).toBe('Level_Sound');
    expect(soundForEvent('contract_signed')).toBe('Contract_Sound');
  });
  it('no demolish sound for decorations', () => {
    expect(soundForEvent('item_demolished', { isDecoration: true })).toBeNull();
    expect(soundForEvent('item_demolished')).toBe('Destroy_Sound');
  });
  it('music by role', () => {
    expect(musicFor({ role: 'owner', tutorialDone: true })).toBe('Main_Music');
    expect(musicFor({ role: 'owner', tutorialDone: false })).toBe('Tutorail_Music');
    expect(musicFor({ role: 'visitor', tutorialDone: true, ownerIsNpc: true })).toBe('Ronald_Music');
    expect(musicFor({ role: 'visitor', tutorialDone: true })).toBe('Tutorail_Music');
  });
  it('parses flags', () => {
    expect(parseFlag('1')).toBe(true);
    expect(parseFlag('0')).toBe(false);
    expect(parseFlag(undefined)).toBe(true);
  });
});
