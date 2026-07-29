export const TEXT_COMMAND_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export function textCommandOptions(options = {}) {
  return {
    encoding: "utf8",
    maxBuffer: TEXT_COMMAND_MAX_BUFFER_BYTES,
    ...options,
  };
}
