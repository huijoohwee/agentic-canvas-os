export function sanitize(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Device/scope must contain an ASCII letter or number.");
  return normalized.slice(0, 48);
}

export function sanitizeDevice(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 48);
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) {
    throw new Error("Device must have ASCII alphanumeric boundaries.");
  }
  return normalized;
}

export function sanitizeScope(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (!normalized) throw new Error("Semantic scope must contain an ASCII letter or number.");
  return normalized;
}
