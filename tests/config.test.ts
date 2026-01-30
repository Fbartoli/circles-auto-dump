import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../src/config.ts";

const VALID_ENV = {
  OWNER_KEY: "0x" + "ab".repeat(32),
  FEE_RECIPIENT: "0x" + "cd".repeat(20),
};

describe("loadConfig", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all config-related env vars
    delete process.env.OWNER_KEY;
    delete process.env.FEE_RECIPIENT;
    delete process.env.RPC_URL;
    delete process.env.INTERVAL_MS;
    delete process.env.MIN_SWAP_AMOUNT_CRC;
    delete process.env.SLIPPAGE_BPS;
    delete process.env.COW_APP_CODE;
    delete process.env.PORT;
    delete process.env.FEE_BPS;
    delete process.env.DB_PATH;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("required variables", () => {
    test("throws if OWNER_KEY is missing", () => {
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      expect(() => loadConfig()).toThrow("Missing required environment variable: OWNER_KEY");
    });

    test("throws if FEE_RECIPIENT is missing", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      expect(() => loadConfig()).toThrow("Missing required environment variable: FEE_RECIPIENT");
    });
  });

  describe("OWNER_KEY validation", () => {
    test("throws for non-hex private key", () => {
      process.env.OWNER_KEY = "not-a-hex-key";
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      expect(() => loadConfig()).toThrow("OWNER_KEY must be a valid 66-character hex string");
    });

    test("throws for private key without 0x prefix", () => {
      process.env.OWNER_KEY = "ab".repeat(32);
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      expect(() => loadConfig()).toThrow("OWNER_KEY must be a valid 66-character hex string");
    });

    test("throws for private key with wrong length", () => {
      process.env.OWNER_KEY = "0x" + "ab".repeat(16);
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      expect(() => loadConfig()).toThrow("OWNER_KEY must be a valid 66-character hex string");
    });

    test("accepts valid 66-char hex private key", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config = loadConfig();
      expect(config.privateKey).toBe(VALID_ENV.OWNER_KEY as `0x${string}`);
    });
  });

  describe("programAddress derivation", () => {
    test("derives programAddress from OWNER_KEY", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config = loadConfig();
      // programAddress should be a valid Ethereum address
      expect(config.programAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    test("same key produces same address", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config1 = loadConfig();
      const config2 = loadConfig();
      expect(config1.programAddress).toBe(config2.programAddress);
    });
  });

  describe("FEE_RECIPIENT validation", () => {
    test("throws for non-hex address", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = "not-an-address";
      expect(() => loadConfig()).toThrow("FEE_RECIPIENT must be a valid 42-character hex address");
    });

    test("throws for address with wrong length", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = "0x" + "cd".repeat(10);
      expect(() => loadConfig()).toThrow("FEE_RECIPIENT must be a valid 42-character hex address");
    });
  });

  describe("defaults", () => {
    test("uses default RPC_URL", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config = loadConfig();
      expect(config.rpcUrl).toBe("https://rpc.aboutcircles.com");
    });

    test("uses default INTERVAL_MS (15 min)", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config = loadConfig();
      expect(config.intervalMs).toBe(900000);
    });

    test("uses default MIN_SWAP_AMOUNT_CRC (1.0)", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config = loadConfig();
      expect(config.minSwapAmountCrc).toBe(1.0);
    });

    test("uses default SLIPPAGE_BPS (300 = 3%)", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config = loadConfig();
      expect(config.slippageBps).toBe(300);
    });

    test("uses default COW_APP_CODE", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config = loadConfig();
      expect(config.cowAppCode).toBe("circles-auto-dump");
    });

    test("uses default PORT (3000)", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config = loadConfig();
      expect(config.port).toBe(3000);
    });

    test("uses default FEE_BPS (2000 = 20%)", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config = loadConfig();
      expect(config.feeBps).toBe(2000);
    });

    test("uses default DB_PATH", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      const config = loadConfig();
      expect(config.dbPath).toBe("./data/users.db");
    });
  });

  describe("custom values", () => {
    test("accepts custom RPC_URL", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.RPC_URL = "https://custom-rpc.example.com";
      const config = loadConfig();
      expect(config.rpcUrl).toBe("https://custom-rpc.example.com");
    });

    test("accepts custom INTERVAL_MS", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.INTERVAL_MS = "120000";
      const config = loadConfig();
      expect(config.intervalMs).toBe(120000);
    });

    test("accepts custom DB_PATH", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.DB_PATH = "/custom/path.db";
      const config = loadConfig();
      expect(config.dbPath).toBe("/custom/path.db");
    });
  });

  describe("INTERVAL_MS boundary validation", () => {
    test("throws for INTERVAL_MS below 60000", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.INTERVAL_MS = "59999";
      expect(() => loadConfig()).toThrow("INTERVAL_MS must be a number >= 60000");
    });

    test("accepts INTERVAL_MS of exactly 60000", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.INTERVAL_MS = "60000";
      const config = loadConfig();
      expect(config.intervalMs).toBe(60000);
    });

    test("throws for non-numeric INTERVAL_MS", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.INTERVAL_MS = "abc";
      expect(() => loadConfig()).toThrow("INTERVAL_MS must be a number >= 60000");
    });
  });

  describe("SLIPPAGE_BPS boundary validation", () => {
    test("throws for SLIPPAGE_BPS below 10", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.SLIPPAGE_BPS = "9";
      expect(() => loadConfig()).toThrow("SLIPPAGE_BPS must be between 10");
    });

    test("throws for SLIPPAGE_BPS above 5000", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.SLIPPAGE_BPS = "5001";
      expect(() => loadConfig()).toThrow("SLIPPAGE_BPS must be between 10");
    });

    test("accepts SLIPPAGE_BPS of exactly 10", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.SLIPPAGE_BPS = "10";
      const config = loadConfig();
      expect(config.slippageBps).toBe(10);
    });

    test("accepts SLIPPAGE_BPS of exactly 5000", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.SLIPPAGE_BPS = "5000";
      const config = loadConfig();
      expect(config.slippageBps).toBe(5000);
    });
  });

  describe("FEE_BPS validation", () => {
    test("throws for FEE_BPS below 1", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.FEE_BPS = "0";
      expect(() => loadConfig()).toThrow("FEE_BPS must be between 1");
    });

    test("throws for FEE_BPS above 5000", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.FEE_BPS = "5001";
      expect(() => loadConfig()).toThrow("FEE_BPS must be between 1");
    });
  });

  describe("MIN_SWAP_AMOUNT_CRC validation", () => {
    test("throws for zero value", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.MIN_SWAP_AMOUNT_CRC = "0";
      expect(() => loadConfig()).toThrow("MIN_SWAP_AMOUNT_CRC must be a positive number");
    });

    test("throws for negative value", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.MIN_SWAP_AMOUNT_CRC = "-1";
      expect(() => loadConfig()).toThrow("MIN_SWAP_AMOUNT_CRC must be a positive number");
    });

    test("accepts fractional values", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.MIN_SWAP_AMOUNT_CRC = "0.5";
      const config = loadConfig();
      expect(config.minSwapAmountCrc).toBe(0.5);
    });
  });

  describe("PORT validation", () => {
    test("throws for PORT below 1", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.PORT = "0";
      expect(() => loadConfig()).toThrow("PORT must be between 1 and 65535");
    });

    test("throws for PORT above 65535", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.PORT = "65536";
      expect(() => loadConfig()).toThrow("PORT must be between 1 and 65535");
    });

    test("accepts PORT 8080", () => {
      process.env.OWNER_KEY = VALID_ENV.OWNER_KEY;
      process.env.FEE_RECIPIENT = VALID_ENV.FEE_RECIPIENT;
      process.env.PORT = "8080";
      const config = loadConfig();
      expect(config.port).toBe(8080);
    });
  });
});
