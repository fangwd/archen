export type ModelConfig = {
  create?: boolean | string;
  select?: boolean | string | { single: string; multiple: string };
  update?: boolean | string | { single: string; multiple: string };
  upsert?: boolean | string;
  delete?: boolean | string | { single: string; multiple: string };
};

export function isModelSelectable(
  config: undefined | boolean | ModelConfig,
  defaultValue: boolean
) {
  return isModelAllowedWith(config, 'select', defaultValue);
}

export function isModelCreatable(
  config: undefined | boolean | ModelConfig,
  defaultValue: boolean
) {
  return isModelAllowedWith(config, 'create', defaultValue);
}

export function isModelUpdatable(
  config: undefined | boolean | ModelConfig,
  defaultValue: boolean
) {
  return isModelAllowedWith(config, 'update', defaultValue);
}

export function isModelUpsertable(
  config: undefined | boolean | ModelConfig,
  defaultValue: boolean
) {
  return isModelAllowedWith(config, 'upsert', defaultValue);
}

export function isModelDeletable(
  config: undefined | boolean | ModelConfig,
  defaultValue: boolean
) {
  return isModelAllowedWith(config, 'delete', defaultValue);
}

export function isModelAccessible(
  config: undefined | boolean | ModelConfig,
  defaultValue: boolean
) {
  if (config === undefined) {
    return defaultValue;
  }
  if (typeof config === 'boolean') {
    return config;
  }
  if (typeof config === 'string') {
    return !!config;
  }
  return defaultValue;
}

function isModelAllowedWith(
  config: boolean | string | ModelConfig,
  field: keyof ModelConfig,
  defaultValue: boolean
) {
  if (config === undefined) {
    return defaultValue;
  }
  if (typeof config === 'boolean') {
    return config;
  }
  if (typeof config === 'string') {
    return !!config;
  }
  return config[field];
}

export function getModelTypeName(
  config: boolean | string | ModelConfig,
  field: keyof ModelConfig,
  defaultValue: string,
  multiple?: boolean
): string {
  if (!config || typeof config !== 'object') {
    return defaultValue;
  }
  const typeName = config[field];
  return typeof typeName === 'string'
    ? typeName
    : typeof typeName === 'object'
    ? multiple
      ? typeName.multiple
      : typeName.single
    : defaultValue;
}
