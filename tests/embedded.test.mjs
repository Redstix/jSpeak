import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddedSession, EMBEDDED_DEFAULTS } from '../src/core/embedded.js';
import { createClauseReader } from '../src/core/read-clause.js';
import { createClauseTokenizer } from '../src/core/tokenize-clause.js';
const bytes = text => Uint8Array.from(Buffer.from(text + '\0'));

test('embedded defaults and ASCII command lookup retain original command bytes and terminator bit', () => {
  assert.deepEqual(EMBEDDED_DEFAULTS, [0, 50, 175, 100, 50, 0, 0, 0, 175, 0, 0, 0, 0, 0, 0]);
  const session = createEmbeddedSession();
  assert.deepEqual(session.consume(bytes('p'), 0), { sourceIndex: 0, added: 0 });
  assert.deepEqual(session.consume(bytes('+P'), 0), { sourceIndex: 2, added: 1 });
  assert.deepEqual(session.state().list, [12801]);
  session.markWord(); assert.deepEqual(session.state().list, [12929]);
  assert.equal(session.state().pendingCount, 0);
});

test('command capacity keeps the source pointer unchanged after the 248 accepted slots', () => {
  const session = createEmbeddedSession();
  for (let i = 0; i < 248; i++) assert.equal(session.consume(bytes('P'), 0).added, 1);
  assert.deepEqual(session.consume(bytes('50P'), 0), { sourceIndex: 0, added: 0 });
  assert.equal(session.state().embeddedIx, 248);
  session.beginClause(); assert.equal(session.state().embeddedIx, 0);
});

test('atoi narrowing and signed-long saturation preserve the fixed Linux oracle default sentinel', () => {
  for (const number of ['4294967295', '9223372036854775807', '9223372036854775808', '18446744073709551616']) {
    const session = createEmbeddedSession(); session.consume(bytes(number + 'P'), 0);
    assert.deepEqual(session.state().list, [12801]); // atoi result -1 selects default pitch
  }
  const wrapped = createEmbeddedSession(); wrapped.consume(bytes('4294967296P'), 0);
  assert.deepEqual(wrapped.state().list, [1]);
});

test('same-session say-as persists across clauses while each clause starts a fresh command list', () => {
  const shared = createEmbeddedSession();
  const tokenizer = createClauseTokenizer({ embedded: shared });
  const reader = createClauseReader(bytes('\x0118Y Ab. Cd.'));
  assert.equal(Buffer.from(tokenizer.tokenize(reader.next()).sbuf).toString(), '\0  Ab ');
  const second = tokenizer.tokenize(reader.next());
  assert.equal(Buffer.from(second.sbuf).toString(), '\0  Cd ');
  assert.equal(second.embeddedStateBefore.optionSayas2, 18);
  assert.deepEqual(second.embeddedStateBefore.list, []);
  assert.equal(createEmbeddedSession().state().optionSayas2, 0);
});

test('Word_EmbeddedCmd consumption uses packed values and stops at the word terminator', () => {
  const session = createEmbeddedSession();
  session.consume(bytes('12B'), 0); session.consume(bytes('18Y'), 0); session.markWord();
  session.consume(bytes('3F'), 0); session.markWord();
  assert.equal(session.consumeWordCommands(3), 15);
  assert.equal(session.state().optionSayas, 18); assert.equal(session.state().optionEmphasis, 0);
  assert.equal(session.state().embeddedRead, 2);
  assert.equal(session.consumeWordCommands(0), 0);
  assert.equal(session.state().optionEmphasis, 3); assert.equal(session.state().embeddedRead, 3);
});
