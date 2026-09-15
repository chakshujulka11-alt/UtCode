import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeFile,
  buildDependencyGraph,
  extractExports,
  parseImports,
  scanImports
} from "../src/main/fileSystem/importScanner";

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "utcode-scan-"));
  writeFileSync(
    path.join(root, "App.tsx"),
    `import Header from "./components/Header";
import { helper } from './utils/api';
import * as fmt from "./utils/format";
const legacy = require("./legacy/old");
export { something } from "./utils/api";
export default function App() { return <Header />; }
`
  );
  writeFileSync(path.join(root, "server.js"), `import express from "express";\nconst { x } = require("./routes/index");\n`);
  writeFileSync(path.join(root, "main.py"), `from .module import thing\nfrom package.sub import other\nimport os.path\nimport sibling\n`);
  mkDir("components");
  mkDir("utils");
  mkDir("legacy");
  mkDir("routes");
  mkDir("pkg");
  writeFileSync(path.join(root, "components", "Header.tsx"), `export function Header() { return null; }\nexport const SIZE = 10;\n`);
  writeFileSync(path.join(root, "utils", "api.ts"), `export async function helper(): Promise<number> { return 1; }\nexport interface Cfg { a: string }\n`);
  writeFileSync(path.join(root, "utils", "format.js"), `export const fmt = {};\n`);
  writeFileSync(path.join(root, "legacy", "old.js"), `module.exports = 1;\n`);
  writeFileSync(path.join(root, "routes", "index.js"), `export const x = 1;\n`);
  writeFileSync(path.join(root, "pkg", "__init__.py"), `def top_level():\n    pass\n\nclass Widget:\n    pass\n`);
});

function mkDir(name: string): void {
  mkdirSync(path.join(root, name), { recursive: true });
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseImports (JS/TS)", () => {
  it("captures default, named, namespace, require and re-export specifiers", () => {
    const src = `import Header from "./components/Header";
import { helper } from './utils/api';
import * as fmt from "./utils/format";
const legacy = require("./legacy/old");
export { something } from "./utils/api";
import express from "express";
import("./lazy/thing");`;
    const specs = parseImports(src, ".tsx").map((i) => i.specifier);
    expect(specs).toContain("./components/Header");
    expect(specs).toContain("./utils/api");
    expect(specs).toContain("./utils/format");
    expect(specs).toContain("./legacy/old");
    expect(specs).toContain("./lazy/thing");
    expect(specs).toContain("express");
  });

  it("parses python imports with relative levels", () => {
    const specs = parseImports(`from .module import thing\nfrom ..pkg.sub import x\nimport os.path\nimport a, b\n`, ".py");
    const module = specs.find((s) => s.specifier === "module");
    expect(module?.pythonLevel).toBe(1);
    const pkg = specs.find((s) => s.specifier === "pkg.sub");
    expect(pkg?.pythonLevel).toBe(2);
    expect(specs.some((s) => s.specifier === "os.path")).toBe(true);
  });
});

describe("resolve + scan", () => {
  it("resolves local TS/JS imports to files with extensions and indexes", async () => {
    const imports = await analyzeFile(root, path.join(root, "App.tsx"));
    const header = imports.find((i) => i.specifier === "./components/Header");
    expect(header?.resolvedPath?.replace(/\\/g, "/")).toBe("components/Header.tsx");
    expect(header?.exports).toContain("Header");
    const api = imports.find((i) => i.specifier === "./utils/api");
    expect(api?.resolvedPath?.replace(/\\/g, "/")).toBe("utils/api.ts");
    expect(api?.exports).toContain("helper");
    const routes = await analyzeFile(root, path.join(root, "server.js"));
    const idx = routes.find((i) => i.specifier === "./routes/index");
    expect(idx?.resolvedPath?.replace(/\\/g, "/")).toBe("routes/index.js");
  });

  it("leaves external packages unresolved", async () => {
    const imports = await analyzeFile(root, path.join(root, "server.js"));
    const express = imports.find((i) => i.specifier === "express");
    expect(express?.resolvedPath).toBeNull();
  });

  it("resolves python relative imports to package init files", async () => {
    const abs = path.join(root, "main.py");
    const imports = await analyzeFile(root, abs);
    const pkg = imports.find((i) => i.specifier === "pkg");
    void pkg;
    writeFileSync(path.join(root, "user.py"), `from pkg import thing\n`);
    const user = await analyzeFile(root, path.join(root, "user.py"));
    expect(user.find((i) => i.specifier === "pkg")?.resolvedPath).toBeTruthy();
  });

  it("builds a compact report with imports and importers", async () => {
    const report = await scanImports(root, path.join(root, "App.tsx"));
    expect(report.file).toBe("App.tsx");
    expect(report.imports.some((i) => i.resolvedPath?.includes("Header"))).toBe(true);
    expect(report.importedBy.length).toBeGreaterThanOrEqual(0);
  });

  it("builds a dependency graph without infinite recursion", async () => {
    writeFileSync(path.join(root, "cycleA.ts"), `import "./cycleB";\n`);
    writeFileSync(path.join(root, "cycleB.ts"), `import "./cycleA";\n`);
    const graph = await buildDependencyGraph(root, path.join(root, "cycleA.ts"), 4);
    expect(graph["cycleA.ts"]).toContain("cycleB.ts");
    expect(Object.keys(graph).length).toBeLessThanOrEqual(10);
  });
});

describe("extractExports", () => {
  it("extracts functions, classes, consts and types", () => {
    const src = `export function alpha() {}\nexport class Beta {}\nexport const GAMMA = 1;\nexport interface Delta {}\nexport type Epsilon = string;\nexport default function main() {}\nexport { zed };`;
    const names = extractExports(src, ".ts");
    expect(names).toContain("alpha");
    expect(names).toContain("Beta");
    expect(names).toContain("GAMMA");
    expect(names).toContain("Delta");
    expect(names).toContain("Epsilon");
    expect(names).toContain("zed");
  });

  it("extracts python defs and classes", () => {
    const names = extractExports(`def one():\n    pass\n\nclass Two:\n    pass\n\nTHREE = 3\n_private = 4\n`, ".py");
    expect(names).toContain("one");
    expect(names).toContain("Two");
    expect(names).toContain("THREE");
    expect(names).not.toContain("_private");
  });
});
