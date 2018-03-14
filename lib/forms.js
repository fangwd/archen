const DICT = {
  category: 'categories',
  child: 'children',
  hierarchy: 'hierarchies',
  property: 'properties'
};

function pluralise(name) {
  const words = name.split('_');
  const noun = words[words.length - 1];
  words[words.length - 1] = DICT[noun] || noun + 's';
  return words.join('_');
}

function snakeToCamel(s) {
  return s.replace(/_\w/g, m => m[1].toUpperCase());
}

function snakeToPascal(s) {
  s = snakeToCamel(s)
  return s[0].toUpperCase() + s.substr(1);
}

module.exports = { pluralise, snakeToCamel, snakeToPascal };
