const { test } = require('node:test');
const assert = require('node:assert');
const { cheapestByName } = require('./poeNinja');

test('cheapestByName keeps the lowest chaosValue per name', () => {
  const lines = [
    { name: 'Foo', chaosValue: 10, _category: 'UniqueWeapon' },
    { name: 'Foo', chaosValue: 5, _category: 'UniqueWeapon' },
    { name: 'Bar', chaosValue: 20, _category: 'UniqueArmour' },
  ];
  const result = cheapestByName(lines).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepStrictEqual(result, [
    { name: 'Bar', chaosValue: 20, _category: 'UniqueArmour' },
    { name: 'Foo', chaosValue: 5, _category: 'UniqueWeapon' },
  ]);
});

test('cheapestByName drops lines with no name or a non-numeric chaosValue', () => {
  const lines = [
    { chaosValue: 3, _category: 'UniqueWeapon' },
    { name: 'Foo', chaosValue: 'not-a-number', _category: 'UniqueWeapon' },
    { name: 'Foo', chaosValue: 7, _category: 'UniqueWeapon' },
  ];
  assert.deepStrictEqual(cheapestByName(lines), [{ name: 'Foo', chaosValue: 7, _category: 'UniqueWeapon' }]);
});

test('cheapestByName returns an empty array for empty input', () => {
  assert.deepStrictEqual(cheapestByName([]), []);
});
