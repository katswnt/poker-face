import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readPlayJson } from "../src/lib/hu-play/sources/library-data";

test("play policy fetch binds exact bytes, enforces streaming bounds, and forwards abort/security options", async () => {
  const bytes = new TextEncoder().encode('{"test":1}'), sha256 = createHash("sha256").update(bytes).digest("hex");
  const ref = { url: `/solver-data/hu-play-v1/test/${sha256}/flop.json`, bytes: bytes.length, sha256 };
  const controller = new AbortController();
  let cancelled = false;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, ref.url); assert.equal(init?.signal, controller.signal);
    assert.equal(init?.credentials, "same-origin"); assert.equal(init?.redirect, "error");
    return new Response(new ReadableStream({ start(stream) { stream.enqueue(bytes); stream.close(); } }));
  };
  assert.deepEqual(await readPlayJson(ref.url, controller.signal, fetcher, ref), { value: { test: 1 }, sha256 });
  await assert.rejects(() => readPlayJson(ref.url, undefined, async () => new Response(bytes), { ...ref, sha256: "0".repeat(64) }), /integrity/);
  await assert.rejects(() => readPlayJson(ref.url, undefined, async () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new Uint8Array(bytes.length + 1)); }, cancel() { cancelled = true; },
  }), { headers: { "Content-Length": "1" } }), ref), /bounded/);
  assert.equal(cancelled, true);
  await assert.rejects(() => readPlayJson("https://example.com/policy", undefined, fetcher), /unapproved/);
  controller.abort();
  await assert.rejects(() => readPlayJson(ref.url, controller.signal, fetcher, ref), /abort/i);
  await assert.rejects(() => readPlayJson(ref.url, undefined, async () => new Response(new Uint8Array([255])),
    { ...ref, bytes: 1, sha256: createHash("sha256").update(new Uint8Array([255])).digest("hex") }), /encoded|encoding|UTF/i);
});
