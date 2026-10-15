/**
 * Client reads of request lists/details go through the GET Route Handlers
 * (parallel fetches) instead of Server Actions (dispatched one at a time).
 * fetchRequestLists coalesces simultaneous loads but never hands a caller a
 * fetch that started before it asked.
 */
import { fetchRequestLists, itemRequestAPI, serviceRequestAPI, setUnauthorizedHandler } from "@/lib/api";

type Pending = { url: string; resolve: (body: unknown, status?: number) => void };
let pending: Pending[];
const fetchMock = jest.fn((url: string) =>
  new Promise((resolveResponse) => {
    pending.push({
      url,
      resolve: (body, status = 200) =>
        resolveResponse({ ok: status >= 200 && status < 300, status, json: async () => body }),
    });
  })
);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const lists = (marker: string) => ({ itemRequests: [{ id: 1, serial: marker }], serviceRequests: [] });

beforeEach(() => {
  pending = [];
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("fetchRequestLists", () => {
  it("shares one fetch between loads requested together", async () => {
    const a = fetchRequestLists("all");
    const b = fetchRequestLists("all");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pending[0].url).toBe("/api/requests?scope=all");
    pending[0].resolve(lists("first"));
    await expect(a).resolves.toEqual(lists("first"));
    await expect(b).resolves.toEqual(lists("first"));
  });

  it("gives a load requested mid-flight a fresh fetch, not the stale one", async () => {
    const early = fetchRequestLists("all");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A status change arrives while the first fetch is still running.
    const late = fetchRequestLists("all");
    const lateToo = fetchRequestLists("all");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1); // waits for the in-flight one

    pending[0].resolve(lists("before-change"));
    await expect(early).resolves.toEqual(lists("before-change"));
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].resolve(lists("after-change"));
    await expect(late).resolves.toEqual(lists("after-change"));
    await expect(lateToo).resolves.toEqual(lists("after-change"));
  });

  it("keeps the own and all scopes separate", async () => {
    void fetchRequestLists("all");
    void fetchRequestLists("own");
    await tick();
    expect(pending.map((p) => p.url).sort()).toEqual(["/api/requests?scope=all", "/api/requests?scope=own"]);
    pending.forEach((p) => p.resolve(lists("x")));
  });

  it("rejects with the server's message and recovers on the next call", async () => {
    const failed = fetchRequestLists("all");
    await tick();
    pending[0].resolve({ error: { code: "FORBIDDEN", message: "Permission denied." } }, 403);
    await expect(failed).rejects.toThrow("Permission denied.");

    const retry = fetchRequestLists("all");
    await tick();
    pending[1].resolve(lists("ok"));
    await expect(retry).resolves.toEqual(lists("ok"));
  });
});

describe("request detail reads", () => {
  it("fetch item and service details from the route by type", async () => {
    const item = itemRequestAPI.getById(5);
    const service = serviceRequestAPI.getById(6);
    await tick();
    expect(pending.map((p) => p.url)).toEqual(["/api/requests/5?type=item", "/api/requests/6?type=service"]);
    pending[0].resolve({ request: { id: 5, serial: "IRS-5" } });
    pending[1].resolve({ request: { id: 6, serial: "SRS-6" } });
    await expect(item).resolves.toEqual({ data: { id: 5, serial: "IRS-5" } });
    await expect(service).resolves.toEqual({ data: { id: 6, serial: "SRS-6" } });
  });

  it("runs detail reads in parallel rather than one at a time", async () => {
    void itemRequestAPI.getById(1);
    void itemRequestAPI.getById(2);
    void fetchRequestLists("all");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    pending.forEach((p) => p.resolve({ request: {}, itemRequests: [], serviceRequests: [] }));
  });

  it("reports an expired session to the auth handler", async () => {
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);
    const read = itemRequestAPI.getById(9);
    await tick();
    pending[0].resolve({ error: { code: "UNAUTHORIZED", message: "Your session has expired. Please log in again." } }, 401);
    await expect(read).rejects.toThrow("Your session has expired");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    setUnauthorizedHandler(null);
  });
});
