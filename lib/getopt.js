'use strict'

function getopt(specs, argv, i) {
  var argv, i, result = { argv: [] };
  if (typeof argv === 'undefined') {
   argv = process.argv, i = 2;
  }
  while (i < argv.length) {
    var arg = argv[i++], j = 0;
    for (; j < specs.length; j++) {
      var spec = specs[j]
      if (spec[2] && arg.substr(0, 2) === spec[0] && arg.length > 2) {
        result[spec[1].substr(2)] = arg.substr(2);
        break;
      }
      if (arg === spec[0] || arg === spec[1]) {
        var key = spec[1].substr(2);
        if (spec[2]) {
          key = typeof spec[2] === 'string' ? spec[2] : key;
          if (i >= argv.length || argv[i][0] === '-') {
            throw "Option '" + arg + "' requires an argument."
          }
          result[key] = argv[i++];
        }
        else {
          result[key] = true;
        }
        break;
      }
    }
    if (j === specs.length) {
      if (arg[0] === '-')
        throw "Unknown option '" + arg + "'.";
      else
        result.argv.push(arg);
    }
  }
  return result;
}

module.exports = getopt;
