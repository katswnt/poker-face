// Plain JS served directly, so TS tooling does not inject helpers into serialized callbacks.
window.runSolverHarness = ({ spotJson, origin }) => new Promise((resolve, reject) => {
  const worker = new Worker(`${origin}/worker.mjs`, { type: "module" });
  let messages = 0, previous = 0, measuredAt = 0;
  const timer = setTimeout(() => { worker.terminate(); reject(new Error("Browser WASM timed out")); }, 120_000);
  const finish = () => { clearTimeout(timer); worker.terminate(); };
  worker.onerror = event => { finish(); reject(new Error(event.message)); };
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") {
      if (data.iterations < previous || data.measuredAtIteration > data.iterations) {
        finish(); reject(new Error("Dishonest progress")); return;
      }
      previous = data.iterations; measuredAt = data.measuredAtIteration; messages++;
    } else if (data.type === "error") { finish(); reject(new Error(data.message)); }
    else if (data.type === "result") {
      finish();
      if (data.preview.final !== false || data.preview.iteration !== data.iterations) {
        reject(new Error("Invalid preview")); return;
      }
      resolve({ digest: data.digest, iterations: data.iterations, nodes: data.nodes, messages, measuredAt,
        linearMemoryBytes: data.linearMemoryBytes, isolated: data.isolated });
    }
  };
  worker.postMessage({ spotJson, moduleUrl: `${origin}/solver_bridge_wasm.js`, wasmUrl: `${origin}/solver_bridge_wasm_bg.wasm` });
});
