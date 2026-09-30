// W1 test-only Worker. No product admission/cancel protocol; the harness terminates it.
self.onmessage = async ({ data }) => {
  try {
    const bindings = await import(data.moduleUrl);
    const instance = await bindings.default({ module_or_path: data.wasmUrl });
    if (!(instance.memory.buffer instanceof ArrayBuffer)) throw new Error("Expected unshared ST memory");
    const session = new bindings.SolverSession(new TextEncoder().encode(data.spotJson));
    let status = JSON.parse(session.allocate());
    self.postMessage({ type: "progress", ...status });
    while (!status.done) {
      status = JSON.parse(session.step(7));
      self.postMessage({ type: "progress", ...status });
      // Real checkpoints, not restarted solves; allow Worker messages between chunks.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const preview = JSON.parse(session.root_strategy());
    const result = JSON.parse(session.finish());
    session.free();
    // Compare the entire numerical result without sending the large flop tree over CDP.
    delete result.timings;
    delete result.memory;
    for (const checkpoint of result.convergence) delete checkpoint.elapsedMs;
    const bytes = new TextEncoder().encode(JSON.stringify(result));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    self.postMessage({ type: "result", digest, iterations: result.iterations, nodes: result.tree.length,
      preview, linearMemoryBytes: instance.memory.buffer.byteLength, isolated: self.crossOriginIsolated });
  } catch (error) {
    // Do not call back into a possibly trapped instance. Host must terminate this Worker.
    self.postMessage({ type: "error", message: String(error) });
  }
};
