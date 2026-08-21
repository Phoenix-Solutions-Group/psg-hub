import { expect, test } from "@playwright/test";

test("liveness preflight: GET /api/health returns ok", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status(), "health endpoint status").toBe(200);
  const body = await response.json();

  expect(body, "health endpoint payload").toMatchObject({
    status: "ok",
    service: "psg-hub",
    timestamp: expect.any(String),
  });
});
