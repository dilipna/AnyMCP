import { describe, expect, it } from "vitest";
import { explainListenError } from "../src/errors";

const ports = { mcpPort: 47820, extPort: 47821 };
const err = (code: string, port: number) => Object.assign(new Error(`listen ${code}`), { code, port });

describe("start-up errors are explained", () => {
  it("a reserved or blocked port says why and how to choose others", () => {
    const m = explainListenError(err("EACCES", 47821), ports)!;
    expect(m).toMatch(/port 47821/);
    expect(m).toMatch(/excludedportrange/);
    expect(m).toMatch(/--mcp-port=48820 --ext-port=48821/);
    expect(m).toMatch(/Show advanced/);
  });
  it("a port in use suggests another bridge", () => {
    expect(explainListenError(err("EADDRINUSE", 47820), ports)).toMatch(/already in use.*another AnyMCP bridge/);
  });
  it("anything else is left to the caller", () => {
    expect(explainListenError(new Error("boom"), ports)).toBeNull();
  });
});
