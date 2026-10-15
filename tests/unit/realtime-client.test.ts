/**
 * Realtime client: an item/service change event is delivered with the
 * changed row attached (one small fetch), so list hooks patch that row
 * instead of reloading their whole list. Newest event wins; a failed lookup
 * falls back to the data-less event (the hooks' full reload).
 */
export {}; // a module, so these names don't collide with other test files

type Listener = (event: { data: string }) => void;

class FakeEventSource {
  static CLOSED = 2;
  static instance: FakeEventSource | null = null;
  readyState = 1;
  listeners = new Map<string, Listener[]>();
  constructor() {
    FakeEventSource.instance = this;
  }
  addEventListener(name: string, cb: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), cb]);
  }
  close() {}
  send(name: string, payload: unknown) {
    for (const cb of this.listeners.get(name) ?? []) cb({ data: JSON.stringify(payload) });
  }
}

type Pending = { url: string; resolve: (status: number, body?: unknown) => void };
let pending: Pending[];
const fetchMock = jest.fn((url: string) =>
  new Promise((resolveResponse) => {
    pending.push({
      url,
      resolve: (status, body) => resolveResponse({ ok: status >= 200 && status < 300, status, json: async () => body }),
    });
  })
);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let subscribe: typeof import("@/lib/realtime-client").subscribeRequestChanged;
let received: Array<Record<string, unknown>>;
let unsubscribe: () => void;

beforeEach(async () => {
  jest.resetModules();
  pending = [];
  fetchMock.mockClear();
  (global as unknown as { window: unknown }).window = {};
  (global as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  global.fetch = fetchMock as unknown as typeof fetch;
  ({ subscribeRequestChanged: subscribe } = await import("@/lib/realtime-client"));
  received = [];
  unsubscribe = subscribe((payload) => received.push(payload as unknown as Record<string, unknown>));
});

afterEach(() => unsubscribe());

const stream = () => FakeEventSource.instance!;

describe("realtime change events", () => {
  it("attaches the changed item request, fetched once", async () => {
    stream().send("change", { type: "item", action: "updated", id: 7, department: "HR" });
    expect(received).toHaveLength(0); // waits for the row
    expect(pending.map((p) => p.url)).toEqual(["/api/requests/7?type=item"]);
    pending[0].resolve(200, { request: { id: 7, serial: "IRS-7", custodian_status: "approved" } });
    await flush();
    expect(received).toEqual([
      expect.objectContaining({ type: "item", action: "updated", id: 7, data: { id: 7, serial: "IRS-7", custodian_status: "approved" } }),
    ]);
  });

  it("uses the service route for service changes", async () => {
    stream().send("change", { type: "service", action: "created", id: 3, department: "HR" });
    expect(pending[0].url).toBe("/api/requests/3?type=service");
    pending[0].resolve(200, { request: { id: 3 } });
    await flush();
    expect(received[0]).toMatchObject({ type: "service", data: { id: 3 } });
  });

  it("delivers only the newest state when events for one request overlap", async () => {
    stream().send("change", { type: "item", action: "updated", id: 7 });
    stream().send("change", { type: "item", action: "updated", id: 7 });
    expect(pending).toHaveLength(2);
    // The newer lookup returns first; the older one resolves late with stale data.
    pending[1].resolve(200, { request: { id: 7, custodian_status: "approved" } });
    await flush();
    pending[0].resolve(200, { request: { id: 7, custodian_status: "pending" } });
    await flush();
    expect(received).toHaveLength(1);
    expect(received[0].data).toEqual({ id: 7, custodian_status: "approved" });
  });

  it("keeps changes to different requests independent", async () => {
    stream().send("change", { type: "item", action: "updated", id: 1 });
    stream().send("change", { type: "item", action: "updated", id: 2 });
    pending[0].resolve(200, { request: { id: 1 } });
    pending[1].resolve(200, { request: { id: 2 } });
    await flush();
    expect(received.map((p) => (p.data as { id: number }).id).sort()).toEqual([1, 2]);
  });

  it.each([
    ["a 404 (outside this narrower scope)", 404],
    ["a server error", 500],
  ])("falls back to the data-less event on %s", async (_case, status) => {
    stream().send("change", { type: "item", action: "updated", id: 9 });
    pending[0].resolve(status, { error: { code: "X", message: "x" } });
    await flush();
    expect(received).toEqual([expect.objectContaining({ type: "item", id: 9, data: undefined })]);
  });

  it("falls back when the lookup can't reach the server", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")));
    stream().send("change", { type: "item", action: "updated", id: 4 });
    await flush();
    expect(received).toEqual([expect.objectContaining({ id: 4, data: undefined })]);
  });

  it.each([
    ["deletions", { type: "item", action: "deleted", id: 5 }],
    ["urgent requests", { type: "urgent", action: "updated", id: 5 }],
    ["reimbursements", { type: "reimbursement", action: "created", id: 5 }],
  ])("passes %s straight through without a lookup", async (_case, event) => {
    stream().send("change", event);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(received).toEqual([expect.objectContaining({ ...event, data: undefined })]);
  });

  it("still resyncs every type after a reconnect (data-less, so lists reload)", async () => {
    stream().send("ready", {});
    stream().send("ready", {});
    expect(received.map((p) => p.type)).toEqual(["item", "service", "urgent", "reimbursement"]);
    expect(received.every((p) => p.id === 0 && p.data === undefined)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
