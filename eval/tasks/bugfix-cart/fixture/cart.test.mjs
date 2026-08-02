import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalPrice, dedupe } from './cart.mjs';

test('totalPrice multiplies by quantity', () => {
  assert.equal(totalPrice([{ price: 10, qty: 3 }]), 30);
});

test('totalPrice applies 10% discount over 100', () => {
  assert.equal(totalPrice([{ price: 60, qty: 2 }]), 108);
});

test('dedupe keeps first occurrence by name', () => {
  const items = [
    { name: 'a', price: 1 },
    { name: 'b', price: 2 },
    { name: 'a', price: 9 },
  ];
  assert.deepEqual(dedupe(items), [{ name: 'a', price: 1 }, { name: 'b', price: 2 }]);
});
