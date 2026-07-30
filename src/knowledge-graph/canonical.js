import { createHash } from "node:crypto";

export function assertPlainObject(value, label = "value") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

export function stableStringify(value) {
  const ancestors = new Set();

  function serialize(current, path) {
    if (current === null) return "null";
    if (typeof current === "string" || typeof current === "boolean") {
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError(`${path} must be a finite number`);
      return Object.is(current, -0) ? "0" : JSON.stringify(current);
    }
    if (typeof current !== "object") {
      throw new TypeError(`${path} is not canonical JSON data`);
    }
    if (ancestors.has(current)) throw new TypeError(`${path} contains a cycle`);

    ancestors.add(current);
    let result;
    if (Array.isArray(current)) {
      const entries = [];
      for (let index = 0; index < current.length; index += 1) {
        if (!Object.hasOwn(current, index)) throw new TypeError(`${path}[${index}] is missing`);
        entries.push(serialize(current[index], `${path}[${index}]`));
      }
      result = `[${entries.join(",")}]`;
    } else {
      assertPlainObject(current, path);
      const symbolKeys = Object.getOwnPropertySymbols(current);
      if (symbolKeys.length > 0) throw new TypeError(`${path} must not have symbol keys`);
      const keys = Object.keys(current).sort(ordinalCompare);
      const entries = keys.map((key) => (
        `${JSON.stringify(key)}:${serialize(current[key], `${path}.${key}`)}`
      ));
      result = `{${entries.join(",")}}`;
    }
    ancestors.delete(current);
    return result;
  }

  return serialize(value, "value");
}

export function sha256(valueOrBytes) {
  const hash = createHash("sha256");
  if (typeof valueOrBytes === "string") {
    hash.update(valueOrBytes, "utf8");
  } else if (valueOrBytes instanceof ArrayBuffer) {
    hash.update(new Uint8Array(valueOrBytes));
  } else if (ArrayBuffer.isView(valueOrBytes)) {
    hash.update(new Uint8Array(
      valueOrBytes.buffer,
      valueOrBytes.byteOffset,
      valueOrBytes.byteLength,
    ));
  } else {
    hash.update(stableStringify(valueOrBytes), "utf8");
  }
  return hash.digest("hex");
}

export function deepFreeze(value, seen = new WeakSet()) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return value;
  }
  if (ArrayBuffer.isView(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, "value")) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
