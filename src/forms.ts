const DICT = {
  address: 'addresses',
  category: 'categories',
  child: 'children',
  hierarchy: 'hierarchies',
  property: 'properties'
};

export function pluralise(name: string): string {
  const words = name.split('_');
  const noun = words[words.length - 1];
  words[words.length - 1] = DICT[noun] || noun + 's';
  return words.join('_');
}

export function toCamelCase(s: string): string {
  return s.replace(/_\w/g, m => m[1].toUpperCase());
}

export function toPascalCase(s: string): string {
  s = toCamelCase(s);
  return s[0].toUpperCase() + s.substr(1);
}
