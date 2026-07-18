import { spawn } from "node:child_process";

export class DockerCommandError extends Error {
  constructor(reasonCode, message, { exitCode = null } = {}) {
    super(message);
    this.name = "DockerCommandError";
    this.reasonCode = reasonCode;
    this.exitCode = exitCode;
  }
}

export function createDockerCommandRunner({ binary = "docker", maxOutputBytes = 1_000_000 } = {}) {
  if (typeof binary !== "string" || !binary.trim()) throw new TypeError("binary must be a non-empty string.");
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new TypeError("maxOutputBytes must be a positive integer.");
  }

  return async function runDocker(args, {
    input,
    signal,
    acceptedExitCodes = [0],
    output = "text",
  } = {}) {
    if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string" || !argument.length)) {
      throw new TypeError("Docker arguments must be non-empty strings.");
    }
    if (signal?.aborted) throw new DockerCommandError("docker_aborted", "Docker operation was aborted.");
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
        finish(reject, new DockerCommandError("docker_aborted", "Docker operation was aborted."));
      };
      const capture = (target) => (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          child.kill("SIGKILL");
          finish(reject, new DockerCommandError("docker_output_capacity", "Docker output exceeded its bound."));
          return;
        }
        target.push(chunk);
      };

      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", capture(stdout));
      child.stderr.on("data", capture(stderr));
      child.on("error", () => {
        finish(reject, new DockerCommandError("docker_unavailable", "Docker CLI could not be started."));
      });
      child.on("close", (exitCode) => {
        if (settled) return;
        if (!acceptedExitCodes.includes(exitCode)) {
          finish(reject, new DockerCommandError(
            "docker_command_failed",
            "Docker command failed.",
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
