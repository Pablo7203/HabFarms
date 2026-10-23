import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { z } from "zod";

const require = createRequire(import.meta.url);
function loadTs(relativePath) {
  const filename = path.resolve(relativePath);
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const Module = require("node:module");
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(code, filename);
  return loaded.exports;
}

const { requiredNumber } = loadTs("src/lib/validation/numbers.ts");
const { validateReceiptUpload } = loadTs("src/lib/validation/receipt.ts");
const { readAllPages } = loadTs("src/lib/pagination.ts");
const sourceId = "123e4567-e89b-42d3-a456-426614174000";

test("required amounts distinguish blank input from a deliberate zero", () => {
  const amount = requiredNumber(z.number().nonnegative(), "amount paid");
  assert.equal(amount.safeParse("").success, false);
  assert.equal(amount.safeParse(null).success, false);
  assert.equal(amount.safeParse("0").data, 0);
  assert.equal(amount.safeParse("12.5").data, 12.5);
});

test("receipt upload rejects SVG and a spoofed PNG signature", async () => {
  const svg = new File(["<svg></svg>"], "receipt.svg", { type: "image/svg+xml" });
  const spoofed = new File(["not an image"], "receipt.png", { type: "image/png" });
  assert.equal((await validateReceiptUpload("expense", sourceId, svg)).ok, false);
  assert.equal((await validateReceiptUpload("expense", sourceId, spoofed)).ok, false);
});

test("receipt upload accepts a matching PNG and rejects invalid record references", async () => {
  const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])], "receipt.png", { type: "image/png" });
  assert.equal((await validateReceiptUpload("expense", sourceId, png)).ok, true);
  assert.equal((await validateReceiptUpload("unexpected", sourceId, png)).ok, false);
  assert.equal((await validateReceiptUpload("expense", "not-a-uuid", png)).ok, false);
});

test("export pagination reads every page, including the final partial one", async () => {
  const data = Array.from({ length: 250 }, (_, index) => index);
  const calls = [];
  const rows = await readAllPages((start, end) => {
    calls.push([start, end]);
    return Promise.resolve({ data: data.slice(start, end + 1), error: null });
  }, 100);
  assert.deepEqual(rows, data);
  assert.deepEqual(calls, [[0, 99], [100, 199], [200, 299]]);
});
