import { describe, expect, test } from "bun:test";

import { openXhrSse, type XhrLike } from "../src/gateway-client/xhr-sse";

/** Scripted fake XHR: the test drives the RN networking callbacks by hand. */
class FakeXhr implements XhrLike {
  status = 0;
  readyState = 0;
  responseText = "";
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  opened: { method: string; url: string } | null = null;
  headers: Record<string, string> = {};
  sent = false;
  aborted = false;

  open(method: string, url: string): void {
    this.opened = { method, url };
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(): void {
    this.sent = true;
  }
  abort(): void {
    this.aborted = true;
  }
  /** Simulate one RN networking callback. */
  emit(readyState: number, status: number, responseText: string): void {
    this.readyState = readyState;
    if (status !== 0) this.status = status;
    this.responseText = responseText;
    this.onreadystatechange?.();
  }
}

async function collect(connection: ReturnType<typeof openXhrSse>, take: number): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of connection.chunks) {
    chunks.push(chunk);
    if (chunks.length >= take) break;
  }
  return chunks;
}

describe("openXhrSse (React Native transport)", () => {
  test("delivers incremental chunks and resolves the header status", async () => {
    const xhr = new FakeXhr();
    const connection = openXhrSse({
      url: "http://gw/v1/runs/r/events",
      headers: { Authorization: "Bearer x", Accept: "text/event-stream" },
      xhrFactory: () => xhr,
    });

    // Header callback order mirrors RN: response info, then incremental data.
    xhr.emit(2, 200, "");
    const statusPromise = connection.status;
    xhr.emit(3, 200, "id: 1\nevent: status\n");
    xhr.emit(3, 200, 'data: {"v":1}\n\n');
    xhr.emit(4, 200, 'id: 1\nevent: status\ndata: {"v":1}\n\n');

    expect(await statusPromise).toBe(200);
    const chunks = await collect(connection, 2);
    expect(chunks.join("")).toBe('id: 1\nevent: status\ndata: {"v":1}\n\n');
    expect(xhr.opened?.method).toBe("GET");
    expect(xhr.headers["Accept"]).toBe("text/event-stream");
    expect(xhr.sent).toBe(true);
  });

  test("aborts the request when the consumer stops early", async () => {
    const xhr = new FakeXhr();
    const connection = openXhrSse({ url: "http://gw/sse", headers: {}, xhrFactory: () => xhr });
    xhr.emit(2, 200, "");
    xhr.emit(3, 200, "data: one\n\n");
    xhr.emit(3, 200, "data: two\n\n");

    const chunks = await collect(connection, 1);
    expect(chunks).toEqual(["data: one\n\n"]);
    // Give the generator's finally block a microtask to run.
    await Promise.resolve();
    expect(xhr.aborted).toBe(true);
  });

  test("delivers the problem body for non-200 statuses", async () => {
    const xhr = new FakeXhr();
    const connection = openXhrSse({ url: "http://gw/sse", headers: {}, xhrFactory: () => xhr });
    xhr.emit(2, 404, "");
    expect(await connection.status).toBe(404);
    const body = '{"code":"run_not_found"}';
    xhr.emit(4, 404, body);
    const chunks = await collect(connection, 1);
    expect(chunks.join("")).toBe(body);
  });

  test("resolves status 0 and throws on network failure", async () => {
    const xhr = new FakeXhr();
    const connection = openXhrSse({ url: "http://gw/sse", headers: {}, xhrFactory: () => xhr });
    const statusPromise = connection.status;
    xhr.onerror?.();
    expect(await statusPromise).toBe(0);
    await expect(collect(connection, 1)).rejects.toThrow("network error");
  });
});
