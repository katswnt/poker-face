import { runFlopLibraryQueue } from "./flop-library-queue";
async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (!["--generate", "--check", "--reproduce"].includes(mode) || rest.some(a => a !== "--resume") || rest.length > 1
    || (rest.length && mode !== "--generate")) throw new Error("Usage: build-flop-library.ts --generate [--resume] | --check | --reproduce");
  const controller = new AbortController(), cancel = () => controller.abort();
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try { console.log(JSON.stringify(await runFlopLibraryQueue(mode.slice(2) as "generate" | "check" | "reproduce", {
    resume: rest.includes("--resume"), signal: controller.signal, onStatus: entry => console.error(JSON.stringify(entry)),
  }))); } finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
