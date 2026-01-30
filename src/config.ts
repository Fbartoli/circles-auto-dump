import { privateKeyToAccount } from "viem/accounts";
import type { Configuration } from "./types.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseHexAddress(value: string, name: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name} must be a valid 42-character hex address (0x + 40 hex chars)`);
  }
  return value as `0x${string}`;
}

function parsePrivateKey(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("OWNER_KEY must be a valid 66-character hex string (0x + 64 hex chars)");
  }
  return value as `0x${string}`;
}

export function loadConfig(): Configuration {
  const privateKey = parsePrivateKey(requireEnv("OWNER_KEY"));

  // Derive program EOA address from private key
  const account = privateKeyToAccount(privateKey);
  const programAddress = account.address;

  const rpcUrl = process.env.RPC_URL || "https://rpc.aboutcircles.com";

  const intervalMs = parseInt(process.env.INTERVAL_MS || "900000", 10);
  if (isNaN(intervalMs) || intervalMs < 60000) {
    throw new Error("INTERVAL_MS must be a number >= 60000 (1 minute)");
  }

  const minSwapAmountCrc = parseFloat(process.env.MIN_SWAP_AMOUNT_CRC || "1.0");
  if (isNaN(minSwapAmountCrc) || minSwapAmountCrc <= 0) {
    throw new Error("MIN_SWAP_AMOUNT_CRC must be a positive number");
  }

  const slippageBps = parseInt(process.env.SLIPPAGE_BPS || "300", 10);
  if (isNaN(slippageBps) || slippageBps < 10 || slippageBps > 5000) {
    throw new Error("SLIPPAGE_BPS must be between 10 (0.1%) and 5000 (50%)");
  }

  const cowAppCode = process.env.COW_APP_CODE || "circles-auto-dump";

  const port = parseInt(process.env.PORT || "3000", 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be between 1 and 65535");
  }

  const feeRecipient = parseHexAddress(requireEnv("FEE_RECIPIENT"), "FEE_RECIPIENT");

  const feeBps = parseInt(process.env.FEE_BPS || "2000", 10);
  if (isNaN(feeBps) || feeBps < 1 || feeBps > 5000) {
    throw new Error("FEE_BPS must be between 1 (0.01%) and 5000 (50%)");
  }

  const dbPath = process.env.DB_PATH || "./data/users.db";

  return {
    privateKey,
    rpcUrl,
    intervalMs,
    minSwapAmountCrc,
    slippageBps,
    cowAppCode,
    port,
    feeRecipient,
    feeBps,
    dbPath,
    programAddress,
  };
}
