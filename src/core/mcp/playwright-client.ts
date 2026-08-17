import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export class PlaywrightMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private isConnected = false;

  /**
   * Khởi động Playwright MCP Server qua tiến trình con stdio
   */
  async connect(options: { headless?: boolean } = {}): Promise<void> {
    if (this.isConnected) return;

    const headless = options.headless ?? true;
    const args = ["playwright", "run-test-mcp-server"];
    if (headless) {
      args.push("--headless");
    }

    // Windows cần npx.cmd
    const isWindows = process.platform === "win32";
    const command = isWindows ? "npx.cmd" : "npx";

    this.transport = new StdioClientTransport({
      command,
      args,
    });

    this.client = new Client(
      { name: "ai-autotest-mcp-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    this.isConnected = true;
  }

  /**
   * Lấy danh sách các công cụ (Tools) do Playwright MCP Server cung cấp
   */
  async getTools(): Promise<any[]> {
    if (!this.client) throw new Error("MCP Client chưa được kết nối.");
    const result = await this.client.listTools();
    return result.tools || [];
  }

  /**
   * Chuyển đổi các công cụ MCP sang định dạng OpenAI Function Calling
   */
  async getOpenAITools(): Promise<OpenAIToolDefinition[]> {
    const mcpTools = await this.getTools();
    return mcpTools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: (tool.inputSchema as Record<string, unknown>) || {
          type: "object",
          properties: {},
        },
      },
    }));
  }

  /**
   * Thực thi một công cụ trên Playwright MCP Server
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    if (!this.client) throw new Error("MCP Client chưa được kết nối.");
    try {
      const response = await this.client.callTool({
        name,
        arguments: args,
      });

      if (Array.isArray(response.content)) {
        return response.content
          .map((item: any) => (item.type === "text" ? item.text : JSON.stringify(item)))
          .join("\n");
      }
      return typeof response === "string" ? response : JSON.stringify(response);
    } catch (error: any) {
      return `[LỖI THỰC THI TOOL ${name}]: ${error.message || String(error)}`;
    }
  }

  /**
   * Đóng kết nối MCP Server
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    try {
      if (this.transport) {
        await this.transport.close();
      }
    } catch {
      // Bỏ qua lỗi khi đóng tiến trình
    } finally {
      this.client = null;
      this.transport = null;
      this.isConnected = false;
    }
  }
}
