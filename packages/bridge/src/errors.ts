// Human explanations for start-up failures that otherwise surface as bare error codes.

/** A port problem the user can act on, or null. */
export function explainListenError(e: unknown, ports: { mcpPort: number; extPort: number }): string | null {
  const err = e as NodeJS.ErrnoException & { port?: number };
  const port = err.port ?? "";
  if (err.code === "EADDRINUSE") return `Port ${port} is already in use. Is another AnyMCP bridge running? Use --mcp-port / --ext-port to choose others.`;
  if (err.code === "EACCES") {
    return [
      `The system does not allow listening on port ${port} (it is reserved or blocked).`,
      `On Windows, Hyper-V, WSL or Docker often reserve port ranges; see them with: netsh interface ipv4 show excludedportrange protocol=tcp`,
      `Choose two free ports, e.g. --mcp-port=${ports.mcpPort + 1000} --ext-port=${ports.extPort + 1000}, and enter the extension address`,
      `(ws://127.0.0.1:<ext-port>/ext) under "Show advanced" when pairing.`,
    ].join("\n  ");
  }
  return null;
}
