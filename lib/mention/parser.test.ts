import { describe, expect, it } from 'vitest';
import { decodeMentions, listMentions } from './parser';

const context = { u1: 'Ada Lovelace', u2: 'Grace Hopper' };

describe('listMentions', () => {
  it('lists the markers in order of appearance with the names decodeMentions shows', () => {
    const text = 'cc @[user_id:u2] and @[user_id:u1]';
    expect(listMentions(text, context, '[deleted user]')).toEqual([
      { id: 'u2', name: 'Grace Hopper' },
      { id: 'u1', name: 'Ada Lovelace' },
    ]);
    expect(decodeMentions(text, context, '[deleted user]')).toBe('cc @Grace Hopper and @Ada Lovelace');
  });

  it('lists a user mentioned twice twice', () => {
    expect(listMentions('@[user_id:u1] and @[user_id:u1] again', context, 'x').map((m) => m.id)).toEqual(['u1', 'u1']);
  });

  it('uses the deleted-user label for an id that is not in the context', () => {
    expect(listMentions('hi @[user_id:gone]', context, '[deleted user]')).toEqual([{ id: 'gone', name: '[deleted user]' }]);
  });

  it('is empty for a message without markers', () => {
    expect(listMentions('plain @name text', context, 'x')).toEqual([]);
  });
});
