import {
  pluralise,
  setPluralForm,
  setPluralForms,
  toCamelCase,
  toPascalCase
} from '../src/misc';

test('pluralise', () => {
  expect(pluralise('category')).toBe('categories');
  expect(pluralise('hierarchy')).toBe('hierarchies');
  expect(pluralise('property')).toBe('properties');
  expect(pluralise('guy')).toBe('guys');
  expect(pluralise('child')).toBe('children');
  expect(pluralise('equipmentChild')).toBe('equipmentChildren');
  expect(pluralise('class')).toBe('classes');
});

test('customise plural forms', () => {
  expect(pluralise('foot')).toBe('foots');
  setPluralForm('foot', 'feet');
  expect(pluralise('totalFoot')).toBe('totalFeet');
  expect(pluralise('special_equipment')).toBe('special_equipments');
  setPluralForms({ tooth: 'teeth', equipment: 'equipment' });
  expect(pluralise('blueTooth')).toBe('blueTeeth');
  expect(pluralise('special_equipment')).toBe('special_equipment');
});

test('camel/pascal cases', () => {
  expect(toCamelCase('special_equipment')).toBe('specialEquipment');
  expect(toPascalCase('special_equipment')).toBe('SpecialEquipment');
});
