import path from "node:path";

export function describeToolTarget(tool: string, args: Record<string, unknown>): string {
  const str = (key: string): string => (typeof args[key] === "string" ? (args[key] as string) : "");
  switch (tool) {
    case "list_directory":
      return str("path") || ".";
    case "read_file":
    case "scan_imports":
      return path.basename(str("path"));
    case "write_file":
    case "patch_file":
      return str("path");
    case "execute_terminal_command":
      return str("command").slice(0, 120);
    case "search_workspace":
      return `"${str("query")}"`;
    case "semantic_search":
      return `~ "${str("query")}"`;
    default: {
      const first = Object.values(args).find((v) => typeof v === "string");
      return typeof first === "string" ? first.slice(0, 80) : "";
    }
  }
}
