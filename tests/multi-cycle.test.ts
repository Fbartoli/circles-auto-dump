import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import { unlinkSync } from "node:fs";
import { initDatabase, closeDatabase } from "../src/db.ts";
import { executeMultiUserCycle } from "../src/multi-cycle.ts";
import type { Configuration, RegisteredUser } from "../src/types.ts";

// Mock the module-executor
const mockIsModuleEnabled = mock(() => Promise.resolve(true));
const mockExecViaModule = mock(() => Promise.resolve("0xmint123"));
const mockExecSingleViaModule = mock(() => Promise.resolve("0xpresign123"));

mock.module("../src/module-executor.ts", () => ({
  isModuleEnabled: mockIsModuleEnabled,
  execViaModule: mockExecViaModule,
  execSingleViaModule: mockExecSingleViaModule,
}));

// Mock circles
const mockGetMintableForUser = mock(() => Promise.resolve(2000000000000000000n));
const mockGetWrappedBalance = mock(() => Promise.resolve(0n));
const mockGetGroupTokenAddress = mock(() => Promise.resolve("0xgrouptoken0000000000000000000000000000" as `0x${string}`));
const mockEncodeMint = mock(() => ({
  to: "0x0000000000000000000000000000000000000001" as `0x${string}`,
  value: 0n,
  data: "0x01" as `0x${string}`,
}));
const mockEncodeFlowWrapApprove = mock(() => [
  { to: "0x0000000000000000000000000000000000000001" as `0x${string}`, value: 0n, data: "0x01" as `0x${string}` },
]);
const mockEncodeApproveOnly = mock(() => [
  { to: "0x0000000000000000000000000000000000000001" as `0x${string}`, value: 0n, data: "0x01" as `0x${string}` },
]);
const mockEncodeUsdcTransfer = mock(() => ({
  to: "0x0000000000000000000000000000000000000002" as `0x${string}`,
  value: 0n,
  data: "0x02" as `0x${string}`,
}));

mock.module("../src/circles.ts", () => ({
  getMintableForUser: mockGetMintableForUser,
  getWrappedBalance: mockGetWrappedBalance,
  getGroupTokenAddress: mockGetGroupTokenAddress,
  encodeMint: mockEncodeMint,
  encodeFlowWrapApprove: mockEncodeFlowWrapApprove,
  encodeApproveOnly: mockEncodeApproveOnly,
  encodeUsdcTransfer: mockEncodeUsdcTransfer,
  USDC_GNOSIS: "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0",
  BASE_GROUP: "0xC19BC204eb1c1D5B3FE500E5E5dfaBaB625F286c",
}));

// Mock pathfinder
const mockFindFlowToGroup = mock(() => Promise.resolve({
  flowVertices: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0xC19BC204eb1c1D5B3FE500E5E5dfaBaB625F286c"],
  flowEdges: [{ streamSinkId: 1, amount: "2000000000000000000" }],
  streams: [{ sourceCoordinate: 0, flowEdgeIds: [0], data: "0x" }],
  packedCoordinates: "0x000000000001",
}));

mock.module("../src/pathfinder.ts", () => ({
  findFlowToGroup: mockFindFlowToGroup,
}));

// Mock cow
const mockGetQuoteAndSubmitOrder = mock(() => Promise.resolve("order-uid-123"));
const mockEncodePresign = mock(() => ({
  to: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41" as `0x${string}`,
  value: 0n,
  data: "0x03" as `0x${string}`,
}));
const mockPollOrderStatus = mock(() => Promise.resolve({ status: "filled" as const, buyAmount: 10000000n }));

mock.module("../src/cow.ts", () => ({
  USDC_GNOSIS: "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0",
  getQuoteAndSubmitOrder: mockGetQuoteAndSubmitOrder,
  encodePresign: mockEncodePresign,
  pollOrderStatus: mockPollOrderStatus,
}));

const TEST_DB = "/tmp/test-multi-cycle-" + Date.now() + ".db";

const mockConfig: Configuration = {
  privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
  rpcUrl: "http://localhost:8545",
  intervalMs: 900000,
  minSwapAmountCrc: 1.0,
  slippageBps: 300,
  cowAppCode: "test",
  port: 3000,
  feeRecipient: "0xfeefeefeefeefeefeefeefeefeefeefeefeefee0",
  feeBps: 2000,
  dbPath: TEST_DB,
  programAddress: "0x0000000000000000000000000000000000000099",
};

const mockUser: RegisteredUser = {
  address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  registeredAt: new Date(),
  status: "active",
  lastProcessedAt: null,
  totalUsdcReceived: 0n,
  totalFeePaid: 0n,
  processCount: 0,
};

const mockWalletClient = {} as any;
const mockPublicClient = {} as any;
const mockOrderBookApi = {} as any;

beforeEach(() => {
  initDatabase(TEST_DB);
  // Reset mocks
  mockIsModuleEnabled.mockImplementation(() => Promise.resolve(true));
  mockExecViaModule.mockImplementation(() => Promise.resolve("0xflow123"));
  mockExecSingleViaModule.mockImplementation(() => Promise.resolve("0xmint123"));
  mockGetMintableForUser.mockImplementation(() => Promise.resolve(2000000000000000000n));
  mockGetWrappedBalance.mockImplementation(() => Promise.resolve(0n));
  mockGetQuoteAndSubmitOrder.mockImplementation(() => Promise.resolve("order-uid-123"));
  mockPollOrderStatus.mockImplementation(() => Promise.resolve({ status: "filled" as const, buyAmount: 10000000n }));
  mockFindFlowToGroup.mockImplementation(() => Promise.resolve({
    flowVertices: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0xC19BC204eb1c1D5B3FE500E5E5dfaBaB625F286c"],
    flowEdges: [{ streamSinkId: 1, amount: "2000000000000000000" }],
    streams: [{ sourceCoordinate: 0, flowEdgeIds: [0], data: "0x" }],
    packedCoordinates: "0x000000000001",
  }));
});

afterEach(() => {
  closeDatabase();
  try {
    unlinkSync(TEST_DB);
    unlinkSync(TEST_DB + "-wal");
    unlinkSync(TEST_DB + "-shm");
  } catch {}
});

test("executeMultiUserCycle processes users and returns results", async () => {
  // Need to add user to DB first for recordUserCycle to work
  const { addUser: dbAddUser } = await import("../src/db.ts");
  dbAddUser(mockUser.address);

  const result = await executeMultiUserCycle(
    mockConfig,
    mockWalletClient,
    mockPublicClient,
    mockOrderBookApi,
    [mockUser],
  );

  expect(result.usersProcessed).toBe(1);
  expect(result.usersSucceeded).toBe(1);
  expect(result.usersFailed).toBe(0);
  expect(result.usersSkipped).toBe(0);
  expect(result.userResults.length).toBe(1);
  expect(result.userResults[0]!.status).toBe("success");
  expect(result.userResults[0]!.mintTxHash).toBe("0xmint123");
});

test("skips user when module is not enabled", async () => {
  const { addUser: dbAddUser } = await import("../src/db.ts");
  dbAddUser(mockUser.address);

  mockIsModuleEnabled.mockImplementation(() => Promise.resolve(false));

  const result = await executeMultiUserCycle(
    mockConfig,
    mockWalletClient,
    mockPublicClient,
    mockOrderBookApi,
    [mockUser],
  );

  expect(result.usersSkipped).toBe(1);
  expect(result.userResults[0]!.status).toBe("skipped");
  expect(result.userResults[0]!.error).toBe("Module not enabled");
});

test("skips user when mintable amount is zero", async () => {
  const { addUser: dbAddUser } = await import("../src/db.ts");
  dbAddUser(mockUser.address);

  mockGetMintableForUser.mockImplementation(() => Promise.resolve(0n));

  const result = await executeMultiUserCycle(
    mockConfig,
    mockWalletClient,
    mockPublicClient,
    mockOrderBookApi,
    [mockUser],
  );

  expect(result.usersSkipped).toBe(1);
  expect(result.userResults[0]!.status).toBe("skipped");
});

test("skips user when mintable amount is below threshold", async () => {
  const { addUser: dbAddUser } = await import("../src/db.ts");
  dbAddUser(mockUser.address);

  // 0.5 CRC = below 1.0 threshold
  mockGetMintableForUser.mockImplementation(() => Promise.resolve(500000000000000000n));

  const result = await executeMultiUserCycle(
    mockConfig,
    mockWalletClient,
    mockPublicClient,
    mockOrderBookApi,
    [mockUser],
  );

  expect(result.usersSkipped).toBe(1);
});

test("handles mint batch failure", async () => {
  const { addUser: dbAddUser } = await import("../src/db.ts");
  dbAddUser(mockUser.address);

  mockExecViaModule.mockImplementation(() => Promise.reject(new Error("Batch reverted")));

  const result = await executeMultiUserCycle(
    mockConfig,
    mockWalletClient,
    mockPublicClient,
    mockOrderBookApi,
    [mockUser],
  );

  expect(result.usersFailed).toBe(1);
  expect(result.userResults[0]!.status).toBe("error");
  expect(result.userResults[0]!.errorStep).toBe("mint");
});

test("handles swap submission failure", async () => {
  const { addUser: dbAddUser } = await import("../src/db.ts");
  dbAddUser(mockUser.address);

  mockGetQuoteAndSubmitOrder.mockImplementation(() => Promise.reject(new Error("Quote failed")));

  const result = await executeMultiUserCycle(
    mockConfig,
    mockWalletClient,
    mockPublicClient,
    mockOrderBookApi,
    [mockUser],
  );

  expect(result.usersFailed).toBe(1);
  expect(result.userResults[0]!.errorStep).toBe("swap");
  expect(result.userResults[0]!.mintTxHash).toBe("0xmint123"); // Mint succeeded
});

test("handles order not filled (expired)", async () => {
  const { addUser: dbAddUser } = await import("../src/db.ts");
  dbAddUser(mockUser.address);

  mockPollOrderStatus.mockImplementation(() => Promise.resolve({ status: "expired" as const, buyAmount: null } as any));

  const result = await executeMultiUserCycle(
    mockConfig,
    mockWalletClient,
    mockPublicClient,
    mockOrderBookApi,
    [mockUser],
  );

  expect(result.usersSkipped).toBe(1);
  expect(result.userResults[0]!.swapStatus).toBe("expired");
});

test("calculates fee correctly (20% = 2000 bps)", async () => {
  const { addUser: dbAddUser } = await import("../src/db.ts");
  dbAddUser(mockUser.address);

  // Order fills for 10 USDC (10_000_000 units with 6 decimals)
  mockPollOrderStatus.mockImplementation(() =>
    Promise.resolve({ status: "filled" as const, buyAmount: 10000000n }),
  );

  const result = await executeMultiUserCycle(
    mockConfig,
    mockWalletClient,
    mockPublicClient,
    mockOrderBookApi,
    [mockUser],
  );

  expect(result.userResults[0]!.usdcReceived).toBe(10000000n);
  // 20% of 10_000_000 = 2_000_000
  expect(result.userResults[0]!.feeAmount).toBe(2000000n);
});

test("processes multiple users sequentially with error isolation", async () => {
  const { addUser: dbAddUser } = await import("../src/db.ts");
  const user2: RegisteredUser = {
    ...mockUser,
    address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };

  dbAddUser(mockUser.address);
  dbAddUser(user2.address);

  let callCount = 0;
  mockExecViaModule.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return Promise.reject(new Error("First user fails"));
    return Promise.resolve("0xmint456");
  });

  const result = await executeMultiUserCycle(
    mockConfig,
    mockWalletClient,
    mockPublicClient,
    mockOrderBookApi,
    [mockUser, user2],
  );

  expect(result.usersProcessed).toBe(2);
  expect(result.usersFailed).toBe(1);
  expect(result.usersSucceeded).toBe(1);
  // First user failed, second succeeded
  expect(result.userResults[0]!.status).toBe("error");
  expect(result.userResults[1]!.status).toBe("success");
});
