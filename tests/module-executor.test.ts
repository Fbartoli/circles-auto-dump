import { test, expect } from "bun:test";
import { encodeMultiSendData, type ModuleTransaction } from "../src/module-executor.ts";

test("encodeMultiSendData encodes a single transaction correctly", () => {
  const txs: ModuleTransaction[] = [
    {
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 0n,
      data: "0xabcdef12",
    },
  ];

  const encoded = encodeMultiSendData(txs);

  // Should be a hex string starting with 0x
  expect(encoded.startsWith("0x")).toBe(true);

  // Decode: operation (1 byte) + to (20 bytes) + value (32 bytes) + dataLength (32 bytes) + data (4 bytes) = 89 bytes = 178 hex chars
  // Total encoded: "0x" + 178 = 180 chars
  const rawHex = encoded.slice(2);

  // operation byte = 00 (Call)
  expect(rawHex.slice(0, 2)).toBe("00");

  // to address (20 bytes = 40 hex chars)
  expect(rawHex.slice(2, 42).toLowerCase()).toBe("1234567890abcdef1234567890abcdef12345678");

  // value (32 bytes = 64 hex chars, should be 0)
  expect(BigInt("0x" + rawHex.slice(42, 106))).toBe(0n);

  // data length (32 bytes = 64 hex chars, should be 4)
  expect(BigInt("0x" + rawHex.slice(106, 170))).toBe(4n);

  // data (4 bytes = 8 hex chars)
  expect(rawHex.slice(170, 178).toLowerCase()).toBe("abcdef12");
});

test("encodeMultiSendData encodes multiple transactions", () => {
  const txs: ModuleTransaction[] = [
    {
      to: "0x1111111111111111111111111111111111111111",
      value: 0n,
      data: "0xaa",
    },
    {
      to: "0x2222222222222222222222222222222222222222",
      value: 1000n,
      data: "0xbbcc",
    },
  ];

  const encoded = encodeMultiSendData(txs);
  expect(encoded.startsWith("0x")).toBe(true);

  // Two transactions packed together
  const rawHex = encoded.slice(2);

  // First tx: 1 + 20 + 32 + 32 + 1 = 86 bytes = 172 hex chars
  // Second tx: 1 + 20 + 32 + 32 + 2 = 87 bytes = 174 hex chars
  // Total: 346 hex chars
  expect(rawHex.length).toBe(172 + 174);
});

test("encodeMultiSendData handles empty data (0x)", () => {
  const txs: ModuleTransaction[] = [
    {
      to: "0x1111111111111111111111111111111111111111",
      value: 100n,
      data: "0x",
    },
  ];

  const encoded = encodeMultiSendData(txs);
  const rawHex = encoded.slice(2);

  // data length should be 0
  expect(BigInt("0x" + rawHex.slice(106, 170))).toBe(0n);

  // No data bytes after length (total: 1 + 20 + 32 + 32 = 85 bytes = 170 hex chars)
  expect(rawHex.length).toBe(170);
});

test("encodeMultiSendData preserves non-zero value", () => {
  const txs: ModuleTransaction[] = [
    {
      to: "0x1111111111111111111111111111111111111111",
      value: 1000000000000000000n, // 1 ETH
      data: "0x",
    },
  ];

  const encoded = encodeMultiSendData(txs);
  const rawHex = encoded.slice(2);

  // value (32 bytes)
  const value = BigInt("0x" + rawHex.slice(42, 106));
  expect(value).toBe(1000000000000000000n);
});
