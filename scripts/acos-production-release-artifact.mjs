import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, opendir } from "node:fs/promises";
import path from "node:path";

import { digestValue } from "./acos-production-release-contract.mjs";

export const ACOS_RELEASE_ARTIFACT_BOUNDS = Object.freeze({
  directories: 32,
  files: 64,
  fileBytes: 1_048_576,
  totalBytes: 4_194_304,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function boundedEntries(directory) {
  const entries = [];
  for await (const entry of await opendir(directory, { bufferSize: 16 })) {
    if (entries.length >= ACOS_RELEASE_ARTIFACT_BOUNDS.files) {
      throw new RangeError("web artifact directory is oversized.");
    }
    entries.push(entry);
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

export async function webArtifactDigestFromDirectory(directoryValue) {
  const directory = path.resolve(directoryValue);
  if (!(await lstat(directory)).isDirectory()) {
    throw new TypeError("web artifact root is not a directory.");
  }
  const pending = [directory];
  const files = [];
  let directories = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const current = pending.shift();
    directories += 1;
    if (directories > ACOS_RELEASE_ARTIFACT_BOUNDS.directories) {
      throw new RangeError("web artifact has too many directories.");
    }
    for (const entry of await boundedEntries(current)) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!entry.isFile()) throw new TypeError("web artifact contains a non-file entry.");
      if (files.length >= ACOS_RELEASE_ARTIFACT_BOUNDS.files) {
        throw new RangeError("web artifact has too many files.");
      }
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.size > ACOS_RELEASE_ARTIFACT_BOUNDS.fileBytes) {
          throw new RangeError("web artifact file is oversized.");
        }
        totalBytes += metadata.size;
        if (totalBytes > ACOS_RELEASE_ARTIFACT_BOUNDS.totalBytes) {
          throw new RangeError("web artifact is oversized.");
        }
        const bytes = Buffer.alloc(metadata.size + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (result.bytesRead === 0) break;
          offset += result.bytesRead;
        }
        if (offset !== metadata.size) throw new TypeError("web artifact changed while sealing.");
        files.push({
          path: path.relative(directory, absolute).split(path.sep).join("/"),
          bytes: offset,
          sha256: sha256(bytes.subarray(0, offset)),
        });
      } finally {
        await handle.close();
      }
    }
  }
  if (files.length === 0) throw new TypeError("web/dist contains no deployable artifact.");
  files.sort((left, right) => left.path.localeCompare(right.path));
  return digestValue(files);
}
