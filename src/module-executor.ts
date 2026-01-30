import {
  type PublicClient,
  type WalletClient,
  encodeFunctionData,
  encodePacked,
  concat,
} from "viem";
import { logger } from "./logger.ts";

// Safe MultiSend 1.4.1 on Gnosis Chain
const MULTI_SEND = "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526" as const;

const safeAbi = [
  {
    name: "execTransactionFromModule",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
  {
    name: "isModuleEnabled",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "module", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const multiSendAbi = [
  {
    name: "multiSend",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "transactions", type: "bytes" }],
    outputs: [],
  },
] as const;

export interface ModuleTransaction {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
}

export async function isModuleEnabled(
  publicClient: PublicClient,
  safeAddress: `0x${string}`,
  moduleAddress: `0x${string}`,
): Promise<boolean> {
  return publicClient.readContract({
    address: safeAddress,
    abi: safeAbi,
    functionName: "isModuleEnabled",
    args: [moduleAddress],
  });
}

/**
 * Encode multiple transactions into a MultiSend-compatible packed bytes payload.
 * Format per tx: uint8 operation || address to || uint256 value || uint256 dataLength || bytes data
 */
export function encodeMultiSendData(transactions: ModuleTransaction[]): `0x${string}` {
  const encoded = transactions.map((tx) => {
    const dataBytes = tx.data === "0x" ? "0x" as `0x${string}` : tx.data;
    const dataLength = dataBytes === "0x" ? 0 : (dataBytes.length - 2) / 2;

    return encodePacked(
      ["uint8", "address", "uint256", "uint256", "bytes"],
      [0, tx.to, tx.value, BigInt(dataLength), dataBytes],
    );
  });

  return concat(encoded);
}

/**
 * Execute a batch of transactions on a user's Safe via execTransactionFromModule.
 * Uses MultiSend with DelegateCall (operation=1) for batching.
 */
export async function execViaModule(
  walletClient: WalletClient,
  publicClient: PublicClient,
  userSafe: `0x${string}`,
  transactions: ModuleTransaction[],
): Promise<string> {
  if (transactions.length === 0) {
    throw new Error("No transactions to execute");
  }

  if (transactions.length === 1) {
    return execSingleViaModule(walletClient, publicClient, userSafe, transactions[0]!);
  }

  // Encode as MultiSend batch
  const multiSendData = encodeMultiSendData(transactions);
  const multiSendCallData = encodeFunctionData({
    abi: multiSendAbi,
    functionName: "multiSend",
    args: [multiSendData],
  });

  logger.debug("Executing MultiSend via module", {
    userSafe,
    txCount: transactions.length,
  });

  const hash = await walletClient.writeContract({
    address: userSafe,
    abi: safeAbi,
    functionName: "execTransactionFromModule",
    args: [MULTI_SEND, 0n, multiSendCallData, 1], // operation=1 = DelegateCall
    chain: walletClient.chain,
    account: walletClient.account!,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`Module batch transaction reverted: ${hash}`);
  }

  logger.info("Module batch transaction executed", { txHash: hash, userSafe });
  return hash;
}

/**
 * Execute a single transaction on a user's Safe via execTransactionFromModule.
 */
export async function execSingleViaModule(
  walletClient: WalletClient,
  publicClient: PublicClient,
  userSafe: `0x${string}`,
  tx: ModuleTransaction,
): Promise<string> {
  logger.debug("Executing single tx via module", {
    userSafe,
    to: tx.to,
  });

  const hash = await walletClient.writeContract({
    address: userSafe,
    abi: safeAbi,
    functionName: "execTransactionFromModule",
    args: [tx.to, tx.value, tx.data, 0], // operation=0 = Call
    chain: walletClient.chain,
    account: walletClient.account!,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`Module transaction reverted: ${hash}`);
  }

  logger.info("Module transaction executed", { txHash: hash, userSafe });
  return hash;
}
