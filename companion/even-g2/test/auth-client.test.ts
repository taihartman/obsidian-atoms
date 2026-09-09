import { describe, expect, it, vi } from "vitest";

import { G2AuthClient, G2HttpClient } from "../src/auth/client";

function clientReturning(response: Response): G2HttpClient {
  const auth = { authorized: vi.fn(async () => response) } as unknown as G2AuthClient;
  return new G2HttpClient(auth);
}

describe("G2 HTTP client", () => {
  it("preserves recognized commit and status states carried by non-2xx responses", async () => {
    const collision = clientReturning(new Response(JSON.stringify({ state: "title_collision" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }));
    await expect(collision.post("/v1/g2/commit", {})).resolves.toEqual({ state: "title_collision" });

    const missing = clientReturning(new Response(JSON.stringify({ state: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }));
    await expect(missing.post("/v1/g2/status", {})).resolves.toEqual({ state: "not_found" });
  });

  it("does not trust unknown error bodies and retains auth and rate-limit mappings", async () => {
    await expect(clientReturning(new Response(JSON.stringify({ state: "invented" }), { status: 409 }))
      .post("/v1/g2/commit", {})).rejects.toThrow("request_failed");
    await expect(clientReturning(new Response(null, { status: 403 }))
      .post("/v1/g2/status", {})).rejects.toThrow("setup_required");
    await expect(clientReturning(new Response(null, { status: 429 }))
      .post("/v1/g2/status", {})).rejects.toThrow("limit_reached");
  });
});
