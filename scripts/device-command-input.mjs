import { readFileSync } from "node:fs";
import path from "node:path";

export function readOption(values, name) {
  const prefix = `--${name}=`;
  const match = values.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

export function readOptions(values, name) {
  const prefix = `--${name}=`;
  return values
    .filter(value => value.startsWith(prefix))
    .map(value => value.slice(prefix.length).trim())
    .filter(Boolean);
}

export function requiredOption(values, name) {
  const value = readOption(values, name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

export function readJsonFile(file, label) {
  const absolutePath = path.resolve(file);
  let value;
  try {
    value = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label} at ${absolutePath}: ${error.message}`);
  }
  return requireJsonObject(value, `${label} must be a JSON object.`);
}

export function parseJsonObject(source, label) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Could not parse ${label}: ${error.message}`);
  }
  return requireJsonObject(value, `${label} must be a JSON object.`);
}

function requireJsonObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}
