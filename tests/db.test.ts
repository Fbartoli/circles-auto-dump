import { test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync } from "node:fs";
import {
  initDatabase,
  closeDatabase,
  addUser,
  getUser,
  getActiveUsers,
  getAllUsers,
  updateUserStatus,
  recordUserCycle,
  getUserHistory,
} from "../src/db.ts";
import type { UserCycleResult } from "../src/types.ts";

const TEST_DB = "/tmp/test-circles-db-" + Date.now() + ".db";

beforeEach(() => {
  initDatabase(TEST_DB);
});

afterEach(() => {
  closeDatabase();
  try {
    unlinkSync(TEST_DB);
    unlinkSync(TEST_DB + "-wal");
    unlinkSync(TEST_DB + "-shm");
  } catch {}
});

test("addUser creates a new user with active status", () => {
  const user = addUser("0x1234567890abcdef1234567890abcdef12345678");
  expect(user.address).toBe("0x1234567890abcdef1234567890abcdef12345678");
  expect(user.status).toBe("active");
  expect(user.processCount).toBe(0);
  expect(user.totalUsdcReceived).toBe(0n);
  expect(user.totalFeePaid).toBe(0n);
  expect(user.lastProcessedAt).toBeNull();
});

test("getUser returns null for unknown address", () => {
  const user = getUser("0x0000000000000000000000000000000000000000");
  expect(user).toBeNull();
});

test("getUser returns the correct user", () => {
  addUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const user = getUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(user).not.toBeNull();
  expect(user!.address).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(user!.status).toBe("active");
});

test("getActiveUsers returns only active users", () => {
  addUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  addUser("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  updateUserStatus("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "paused");

  const active = getActiveUsers();
  expect(active.length).toBe(1);
  expect(active[0]!.address).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("getAllUsers returns all users regardless of status", () => {
  addUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  addUser("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  updateUserStatus("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "paused");

  const all = getAllUsers();
  expect(all.length).toBe(2);
});

test("updateUserStatus changes user status", () => {
  addUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  updateUserStatus("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ineligible");

  const user = getUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(user!.status).toBe("ineligible");
});

test("recordUserCycle stores a successful cycle and updates user stats", () => {
  addUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

  const result: UserCycleResult = {
    userAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    startedAt: new Date("2024-01-01T00:00:00Z"),
    completedAt: new Date("2024-01-01T00:01:00Z"),
    status: "success",
    mintedAmount: 1000000000000000000n,
    mintTxHash: "0xabc123",
    swapOrderId: "order-123",
    swapStatus: "filled",
    usdcReceived: 5000000n, // 5 USDC
    feeAmount: 1000000n, // 1 USDC
    feeTxHash: "0xdef456",
    error: null,
    errorStep: null,
  };

  recordUserCycle(result);

  const user = getUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(user!.processCount).toBe(1);
  expect(user!.totalUsdcReceived).toBe(5000000n);
  expect(user!.totalFeePaid).toBe(1000000n);
  expect(user!.lastProcessedAt).not.toBeNull();
});

test("recordUserCycle does not update stats for error cycles", () => {
  addUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

  const result: UserCycleResult = {
    userAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    startedAt: new Date(),
    completedAt: new Date(),
    status: "error",
    mintedAmount: null,
    mintTxHash: null,
    swapOrderId: null,
    swapStatus: null,
    usdcReceived: null,
    feeAmount: null,
    feeTxHash: null,
    error: "Something failed",
    errorStep: "mint",
  };

  recordUserCycle(result);

  const user = getUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(user!.processCount).toBe(0);
  expect(user!.totalUsdcReceived).toBe(0n);
});

test("getUserHistory returns process logs in descending order", () => {
  addUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

  for (let i = 0; i < 3; i++) {
    recordUserCycle({
      userAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      startedAt: new Date(`2024-01-0${i + 1}T00:00:00Z`),
      completedAt: new Date(`2024-01-0${i + 1}T00:01:00Z`),
      status: "success",
      mintedAmount: BigInt(i + 1) * 10n ** 18n,
      mintTxHash: `0x${i}`,
      swapOrderId: `order-${i}`,
      swapStatus: "filled",
      usdcReceived: BigInt((i + 1) * 1000000),
      feeAmount: BigInt((i + 1) * 200000),
      feeTxHash: `0xfee${i}`,
      error: null,
      errorStep: null,
    });
  }

  const history = getUserHistory("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(history.length).toBe(3);
  // Most recent first
  expect(history[0]!.started_at).toBe("2024-01-03T00:00:00.000Z");
  expect(history[2]!.started_at).toBe("2024-01-01T00:00:00.000Z");
});

test("getUserHistory respects limit", () => {
  addUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

  for (let i = 0; i < 5; i++) {
    recordUserCycle({
      userAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      startedAt: new Date(),
      completedAt: new Date(),
      status: "skipped",
      mintedAmount: null,
      mintTxHash: null,
      swapOrderId: null,
      swapStatus: null,
      usdcReceived: null,
      feeAmount: null,
      feeTxHash: null,
      error: null,
      errorStep: null,
    });
  }

  const history = getUserHistory("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 2);
  expect(history.length).toBe(2);
});

test("addUser throws on duplicate address", () => {
  addUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(() => addUser("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toThrow();
});
