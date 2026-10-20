import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";

export interface CapturedRequest { method?: string; url?: string; authorization?: string; body: any }
export async function mockCompletions(t: TestContext, handler: (request: CapturedRequest, response: ServerResponse, index: number) => void | Promise<void>) {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      let text = ""; for await (const chunk of request) text += chunk;
      const captured = { method: request.method, url: request.url, authorization: request.headers.authorization, body: JSON.parse(text) };
      requests.push(captured);
      await handler(captured, response, requests.length);
    })().catch(() => { if (!response.destroyed) { response.statusCode = 500; response.end(); } });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests };
}
export function completion(text: string, message: Record<string, unknown> = {}, finish_reason: string | null = "stop") {
  return { choices: [{ finish_reason, message: { role: "assistant", content: text, ...message } }] };
}
export function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value));
}
