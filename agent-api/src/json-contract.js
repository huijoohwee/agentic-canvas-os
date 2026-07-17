function assertPlainObject(value, path) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only plain objects.`);
  }
}

export function canonicalizeJson(value, path = "value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers.`);
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`${path} must be JSON-compatible.`);
  if (seen.has(value)) throw new TypeError(`${path} must not contain cycles.`);

  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item, index) => canonicalizeJson(item, `${path}[${index}]`, seen));
  } else {
    assertPlainObject(value, path);
    result = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined) throw new TypeError(`${path}.${key} must not be undefined.`);
      result[key] = canonicalizeJson(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
  return result;
}

export function freezeJson(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
}

export function normalizeJson(value, path = "value") {
  return freezeJson(canonicalizeJson(value, path));
}

export function serializedJsonLength(value) {
  return JSON.stringify(value).length;
}
