const DICT = {
  category: 'categories',
  child: 'children',
  property: 'properties'
};

function pluralise(name) {
  const words = name.split('_');
  const noun = words[words.length - 1];
  if (noun in DICT) {
    words[words.length - 1] = DICT[noun];
  } else {
    words[words.length - 1] = noun + 's';
  }
  return words.join('_');
}

module.exports = { pluralise };
