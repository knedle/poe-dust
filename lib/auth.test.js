const { test } = require('node:test');
const assert = require('node:assert');
const { login, logout, isValidSession, parseCookies } = require('./auth');

test('login with the wrong password returns null', () => {
  assert.strictEqual(login('wrong', 'secret'), null);
});

test('login with the correct password returns a token accepted by isValidSession', () => {
  const token = login('secret', 'secret');
  assert.ok(typeof token === 'string' && token.length > 0);
  assert.strictEqual(isValidSession(token), true);
});

test('an expired session is invalid', () => {
  const token = login('secret', 'secret', -1);
  assert.strictEqual(isValidSession(token), false);
});

test('logout invalidates a session', () => {
  const token = login('secret', 'secret');
  logout(token);
  assert.strictEqual(isValidSession(token), false);
});

test('isValidSession rejects unknown or missing tokens', () => {
  assert.strictEqual(isValidSession('not-a-real-token'), false);
  assert.strictEqual(isValidSession(undefined), false);
});

test('logout on an unknown token does not throw', () => {
  assert.doesNotThrow(() => logout('not-a-real-token'));
});

test('parseCookies parses a multi-cookie header', () => {
  assert.deepStrictEqual(
    parseCookies('session=abc123; other=xyz'),
    { session: 'abc123', other: 'xyz' }
  );
});

test('parseCookies returns an empty object for a missing header', () => {
  assert.deepStrictEqual(parseCookies(undefined), {});
});
