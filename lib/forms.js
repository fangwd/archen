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

module.exports = { pluralise };
