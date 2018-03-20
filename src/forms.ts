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

export function toCamel(s: string): string {
  return s.replace(/_\w/g, m => m[1].toUpperCase());
}

export function toPascal(s: string): string {
  s = toCamel(s);
  return s[0].toUpperCase() + s.substr(1);
}
