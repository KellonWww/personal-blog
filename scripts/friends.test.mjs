import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFriends, publicFriends, MAX_FRIENDS } from '../src/lib/friends.ts';

const friend = { name: '花园', url: 'https://example.com', desc: '朋友的博客' };
const encode = JSON.stringify;

test('friends: existing entries, optional descriptions, normalization and order survive serialization', () => {
  const source = [{ name: '  花园  ', url: ' https://example.com ', desc: '  朋友  ' }, { name: 'Blog', url: 'http://example.org' }];
  const expected = [{ ...friend, desc: '朋友' }, source[1]];
  assert.deepEqual(parseFriends(encode(source)), expected);
  assert.deepEqual(publicFriends(encode(parseFriends(encode(source)))), expected);
  assert.deepEqual(parseFriends('[]'), []);
});

test('friends: malformed JSON, non-array data, wrong fields and incomplete drafts cannot be saved', () => {
  for (const value of ['{', 'null', '{}', 'true', '[null]', '[1]', encode([{ url: friend.url }]), encode([{ ...friend, name: '  ' }]), encode([{ ...friend, url: '' }]), encode([{ ...friend, desc: null }])]) {
    assert.throws(() => parseFriends(value), /友链最多/);
  }
});

test('friends: protocol allowlist applies to both saves and legacy public rendering', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//example.org', '/relative', 'ftp://example.org', 'https://', '']) {
    const value = encode([{ ...friend, url }]);
    assert.throws(() => parseFriends(value));
    assert.deepEqual(publicFriends(value), []);
  }
  assert.equal(parseFriends(encode([{ ...friend, url: 'HTTPS://example.org/a?b=1#c' }])).length, 1);
});

test('friends: item and field limits include exact boundary values', () => {
  assert.equal(parseFriends(encode(Array(MAX_FRIENDS).fill(friend))).length, MAX_FRIENDS);
  assert.throws(() => parseFriends(encode(Array(MAX_FRIENDS + 1).fill(friend))));
  const atLimit = { name: '名'.repeat(100), url: 'https://example.com/' + 'x'.repeat(480), desc: '介'.repeat(500) };
  assert.equal(atLimit.url.length, 500);
  assert.deepEqual(parseFriends(encode([atLimit])), [atLimit]);
  for (const item of [{ ...atLimit, name: atLimit.name + 'a' }, { ...atLimit, url: atLimit.url + 'a' }, { ...atLimit, desc: atLimit.desc + 'a' }]) {
    assert.throws(() => parseFriends(encode([item])));
  }
});

test('friends: malformed legacy settings fail closed and valid entries retain their order', () => {
  for (const value of ['{', 'null', '{}']) assert.deepEqual(publicFriends(value), []);
  assert.deepEqual(publicFriends(encode([null, friend, { ...friend, url: 'javascript:alert(1)' }, { name: 'Other', url: 'http://example.org' }])), [friend, { name: 'Other', url: 'http://example.org' }]);
});
