export function createSuppliedReferenceInventory(documents = []) {
  const keysByPath = new Map();
  const pathsByDocumentKey = new Map();
  for (const document of documents) {
    if (document?.readState !== "ok" || !document.documentKey) continue;
    const documentKey = String(document.documentKey);
    const paths = referencePaths(document);
    pathsByDocumentKey.set(documentKey, paths);
    for (const referencePath of paths) {
      const keys = keysByPath.get(referencePath) ?? new Set();
      keys.add(documentKey);
      keysByPath.set(referencePath, keys);
    }
  }
  return Object.freeze({
    available: true,
    keysByPath,
    pathsByDocumentKey,
  });
}

export function resolveSuppliedReference(entry, reference, inventory) {
  if (inventory?.available !== true) return { inventoried: false, documentKey: null };
  const normalized = normalizeReferencePath(reference);
  if (!normalized) return { inventoried: true, documentKey: null };
  const candidates = new Set([normalized]);
  for (const sourcePath of inventory.pathsByDocumentKey?.get(String(entry.documentKey)) ?? []) {
    if (normalized.startsWith("/")) continue;
    const separator = sourcePath.lastIndexOf("/");
    const directory = separator < 0 ? "" : sourcePath.slice(0, separator);
    candidates.add(normalizeReferencePath(`${directory}/${normalized}`));
  }
  for (const candidate of candidates) {
    const keys = inventory.keysByPath?.get(candidate);
    if (!keys || keys.size === 0) continue;
    return {
      inventoried: true,
      documentKey: [...keys].sort((left, right) => left.localeCompare(right, "en"))[0],
    };
  }
  return { inventoried: true, documentKey: null };
}

export function looksLikeDocumentReference(value) {
  const text = String(value).trim();
  if (
    !text ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(text) ||
    /[\n\r|;&$`()]/u.test(text)
  ) return false;
  const pathPart = text.split("#")[0];
  if (!pathPart || /\s/u.test(pathPart)) return false;
  return /^(?:\.{0,2}\/|\/|[A-Za-z]:[\\/])/u.test(pathPart) ||
    /[\\/]/u.test(pathPart) ||
    /(?:^|[\\/])[^\\/]+\.[\p{Letter}\p{Number}][\p{Letter}\p{Number}._+-]{0,15}$/u
      .test(pathPart);
}

export function referenceAliases(value) {
  const text = String(value)
    .split("#")[0]
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    .replace(/\.(?:md|json|ya?ml)$/iu, "");
  const canonical = text.toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/gu, "");
  const semantic = canonical.replace(/(?:-[0-9a-f]{8,64})+$/u, "");
  return [...new Set([canonical, semantic].filter(Boolean))];
}

function referencePaths(document) {
  const candidates = [
    document.relativeName,
    relativeSubject(document.subject),
    document.readHandle,
  ];
  return [...new Set(candidates.map(normalizeReferencePath).filter(Boolean))].sort();
}

function relativeSubject(subject) {
  const text = String(subject ?? "");
  const separator = text.indexOf(":");
  return separator < 0 ? null : text.slice(separator + 1);
}

function normalizeReferencePath(value) {
  const source = String(value ?? "").trim()
    .split("#")[0]
    .replaceAll("\\", "/");
  if (!source) return "";
  const absolute = source.startsWith("/");
  const segments = [];
  for (const segment of source.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return "";
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  const normalized = segments.join("/");
  return absolute ? `/${normalized}` : normalized;
}
