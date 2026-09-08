import { spawn } from "node:child_process";

export class PodmanCommandError extends Error {
  constructor(reasonCode, message, { exitCode = null } = {}) {
    super(message);
    this.name = "PodmanCommandError";
    this.reasonCode = reasonCode;
    this.exitCode = exitCode;
  }
}

export function createPodmanCommandRunner({ binary = "podman", maxOutputBytes = 1_000_000 } = {}) {
  if (typeof binary !== "string" || !binary.trim()) throw new TypeError("binary must be a non-empty string.");
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new TypeError("maxOutputBytes must be a positive integer.");
  }

  return async function runPodman(args, {
    input,
    signal,
    acceptedExitCodes = [0],
    output = "text",
  } = {}) {
    if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string" || !argument.length)) {
      throw new TypeError("Podman arguments must be non-empty strings.");
    }
    if (signal?.aborted) throw new PodmanCommandError("podman_aborted", "Podman operation was aborted.");
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { shell: false, stdio: ["pipe", "pipe", "pipe"] });
      const stdout = [];
      const stderr = [];
      let outputBytes = 0;
      let settled = false;

      const finish = (handler, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        handler(value);
      };
      const abort = () => {
        child.kill("SIGKILL");
        finish(reject, new PodmanCommandError("podman_aborted", "Podman operation was aborted."));
      };
      const capture = (target) => (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          child.kill("SIGKILL");
          finish(reject, new PodmanCommandError("podman_output_capacity", "Podman output exceeded its bound."));
          return;
        }
        target.push(chunk);
      };

      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", capture(stdout));
      child.stderr.on("data", capture(stderr));
      child.on("error", () => {
        finish(reject, new PodmanCommandError("podman_unavailable", "Podman CLI could not be started."));
      });
      child.on("close", (exitCode) => {
        if (settled) return;
        if (!acceptedExitCodes.includes(exitCode)) {
          finish(reject, new PodmanCommandError(
            "podman_command_failed",
            "Podman command failed.",
            { exitCode },
          ));
          return;
        }
        const stdoutBuffer = Buffer.concat(stdout);
        const stderrBuffer = Buffer.concat(stderr);
        finish(resolve, Object.freeze({
          exitCode,
          stdout: output === "buffer" ? stdoutBuffer : stdoutBuffer.toString("utf8"),
          stderr: output === "buffer" ? stderrBuffer : stderrBuffer.toString("utf8"),
        }));
      });
      if (input === undefined) child.stdin.end();
      else child.stdin.end(input);
    });
  };
}
