import { test, expect, mock, beforeAll, afterAll } from "bun:test";
import { unlinkSync } from "node:fs";
import { initDatabase, addUser } from "../src/db.ts";

// Mock module-executor
mock.module("../src/module-executor.ts", () => ({
  isModuleEnabled: mock(() => Promise.resolve(true)),
}));

// Mock circles
mock.module("../src/circles.ts", () => ({
  isUserEligible: mock(() => Promise.resolve(true)),
  getMintableForUser: mock(() => Promise.resolve(0n)),
  getGroupTokenAddress: mock(() => Promise.resolve("0x0000000000000000000000000000000000000001")),
  getPersonalTokenAddress: mock(() => Promise.resolve("0x0000000000000000000000000000000000000002")),
  encodeMint: mock(() => ({ to: "0x01" as any, value: 0n, data: "0x" as any })),
  encodeFlowWrapApprove: mock(() => []),
  encodeApproveOnly: mock(() => []),
  encodeUsdcTransfer: mock(() => ({ to: "0x01" as any, value: 0n, data: "0x" as any })),
  BASE_GROUP: "0xC19BC204eb1c1D5B3FE500E5E5dfaBaB625F286c",
}));

// Mock cow
mock.module("../src/cow.ts", () => ({
  USDC_GNOSIS: "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0",
  getQuoteAndSubmitOrder: mock(() => Promise.resolve("order-123")),
  encodePresign: mock(() => ({ to: "0x01" as any, value: 0n, data: "0x" as any })),
  pollOrderStatus: mock(() => Promise.resolve({ status: "filled", buyAmount: 1000000n })),
}));

import { startApiServer } from "../src/api.ts";
import type { Configuration } from "../src/types.ts";

const TEST_DB = "/tmp/test-api-" + Date.now() + ".db";
const TEST_PORT = 4500 + Math.floor(Math.random() * 1000);

const mockConfig: Configuration = {
  privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
  rpcUrl: "http://localhost:8545",
  intervalMs: 900000,
  minSwapAmountCrc: 1.0,
  slippageBps: 300,
  cowAppCode: "test",
  port: TEST_PORT,
  feeRecipient: "0xfeefeefeefeefeefeefeefeefeefeefeefeefee0",
  feeBps: 2000,
  dbPath: TEST_DB,
  programAddress: "0x0000000000000000000000000000000000000099",
};

const mockWalletClient = {} as any;
const mockPublicClient = {} as any;
const mockOrderBookApi = {} as any;

let baseUrl: string;
let server: any;

beforeAll(() => {
  initDatabase(TEST_DB);
  server = startApiServer(mockConfig, mockWalletClient, mockPublicClient, mockOrderBookApi);
  baseUrl = `http://localhost:${TEST_PORT}`;
});

afterAll(() => {
  server?.stop?.();
  try {
    unlinkSync(TEST_DB);
    unlinkSync(TEST_DB + "-wal");
    unlinkSync(TEST_DB + "-shm");
  } catch {}
});

test("GET /health returns service status", async () => {
  const res = await fetch(`${baseUrl}/health`);
  expect(res.status).toBe(200);

  const body = (await res.json()) as any;
  expect(body.status).toBe("ok");
  expect(typeof body.uptime).toBe("number");
  expect(body.isCycleInProgress).toBe(false);
  expect(typeof body.totalCycles).toBe("number");
  expect(typeof body.registeredUsers).toBe("number");
});

test("GET /users returns list", async () => {
  const res = await fetch(`${baseUrl}/users`);
  expect(res.status).toBe(200);

  const body = (await res.json()) as any;
  expect(body.users).toBeInstanceOf(Array);
});

test("GET /users/:address returns 404 for unknown user", async () => {
  const res = await fetch(`${baseUrl}/users/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`);
  expect(res.status).toBe(404);
});

test("POST /register rejects invalid address", async () => {
  const res = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "invalid" }),
  });
  expect(res.status).toBe(400);
});

test("POST /register registers valid user", async () => {
  const res = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "0xcccccccccccccccccccccccccccccccccccccccc" }),
  });
  expect(res.status).toBe(201);

  const body = (await res.json()) as any;
  expect(body.user.address).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
});

test("POST /register rejects duplicate registration", async () => {
  // User was registered in previous test
  const res = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "0xcccccccccccccccccccccccccccccccccccccccc" }),
  });
  expect(res.status).toBe(409);
});

test("GET /users/:address returns user details", async () => {
  const res = await fetch(`${baseUrl}/users/0xcccccccccccccccccccccccccccccccccccccccc`);
  expect(res.status).toBe(200);

  const body = (await res.json()) as any;
  expect(body.user.address).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
  expect(body.history).toBeInstanceOf(Array);
});

test("DELETE /users/:address pauses user", async () => {
  const res = await fetch(`${baseUrl}/users/0xcccccccccccccccccccccccccccccccccccccccc`, {
    method: "DELETE",
  });
  expect(res.status).toBe(200);

  const body = (await res.json()) as any;
  expect(body.message).toBe("User paused");
});

test("GET /eligibility/:address returns eligibility info", async () => {
  const res = await fetch(`${baseUrl}/eligibility/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`);
  expect(res.status).toBe(200);

  const body = (await res.json()) as any;
  expect(body.address).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(typeof body.eligible).toBe("boolean");
  expect(typeof body.moduleEnabled).toBe("boolean");
  expect(body.programAddress).toBe(mockConfig.programAddress);
});

test("GET / redirects to /ui", async () => {
  const res = await fetch(`${baseUrl}/`, { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("/ui");
});

test("GET /unknown returns 404", async () => {
  const res = await fetch(`${baseUrl}/unknown`);
  expect(res.status).toBe(404);
});
