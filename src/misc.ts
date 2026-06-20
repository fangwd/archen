export function firstOf(object: { [key: string]: any }) {
  return object[Object.keys(object)[0]];
}
