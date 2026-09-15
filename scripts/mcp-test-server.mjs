import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "utcode-selftest", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echoes the given message back.",
      inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "echo") throw new Error(`Unknown tool: ${request.params.name}`);
  const message = request.params.arguments?.message ?? "";
  return { content: [{ type: "text", text: `echo: ${message}` }] };
});

await server.connect(new StdioServerTransport());
