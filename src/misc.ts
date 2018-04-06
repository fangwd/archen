import { Buffer } from "buffer";

const PLURAL_FORMS = {
  child: 'children'
};

export function pluralise(name: string): string {
  for (const key in PLURAL_FORMS) {
    if (name.endsWith(key)) {
      return name.substr(0, name.length - key.length) + PLURAL_FORMS[key];
    }
    if (name.endsWith(_U(key))) {
      return name.substr(0, name.length - key.length) + _U(PLURAL_FORMS[key]);
    }
  }

  let result;

  if ((result = name.replace(/([^aeiou])y$/i, '$1ies')) != name) {
    return result;
  }

  if ((result = name.replace(/ty$/, 'ties')) != name) {
    return result;
  }

  if ((result = name.replace(/s$/, 'ses')) != name) {
    return result;
  }

  return name + 's';
}

function _U(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function setPluralForms(data: { [key: string]: string }): void {
  for (const key in data) {
    PLURAL_FORMS[key] = data[key];
  }
}

export function setPluralForm(singular: string, plural: string): void {
  PLURAL_FORMS[singular] = plural;
}

export function toCamelCase(s: string): string {
  return s.replace(/_\w/g, m => m[1].toUpperCase());
}

export function toPascalCase(s: string): string {
  s = toCamelCase(s);
  return s[0].toUpperCase() + s.substr(1);
}

export function btoa(value: any) {
  return Buffer.from(value).toString('base64');
}

export function atob(value: any) {
  const string = Buffer.from(value, 'base64').toString();

  const int = parseInt(string, 10);
  if (!isNaN(int)) {
    return int;
  }

  const date = new Date(string)
  if (!isNaN(date.getTime())) {
    return date;
  }

  return value;
}