import test from 'node:test';
import assert from 'node:assert/strict';
import { padActions } from '../ui/js/gamepad.js';

const pad = (pressed = [], axes = [0, 0]) => ({ axes, buttons:Array.from({ length:17 }, (_, i) => ({ pressed:pressed.includes(i) })) });

test('face and shoulder buttons fire once per press', () => {
  const held = {};
  assert.deepEqual(padActions(pad([0, 4, 5, 9]), held, 0), ['a', 'l', 'r', 'start']);
  assert.deepEqual(padActions(pad([0, 4, 5, 9]), held, 16), []);
  padActions(pad(), held, 32);
  assert.deepEqual(padActions(pad([1, 2, 3]), held, 48), ['b', 'x', 'y']);
});

test('the D-pad repeats after a delay', () => {
  const held = {};
  assert.deepEqual(padActions(pad([13]), held, 0), ['down']);
  assert.deepEqual(padActions(pad([13]), held, 349), []);
  assert.deepEqual(padActions(pad([13]), held, 350), ['down']);
  assert.deepEqual(padActions(pad([13]), held, 469), []);
  assert.deepEqual(padActions(pad([13]), held, 470), ['down']);
  padActions(pad(), held, 480);
  assert.deepEqual(padActions(pad([13]), held, 490), ['down']);
});

test('the stick has a dead zone and acts like the D-pad', () => {
  assert.deepEqual(padActions(pad([], [.4, -.4]), {}, 0), []);
  assert.deepEqual(padActions(pad([], [.9, -.9]), {}, 0), ['up', 'right']);
});

test('D-pad and stick together count as one press', () => {
  assert.deepEqual(padActions(pad([15], [1, 0]), {}, 0), ['right']);
});
