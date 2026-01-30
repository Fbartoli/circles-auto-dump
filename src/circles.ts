import {
  encodeFunctionData,
  type PublicClient,
} from "viem";
import type { ModuleTransaction } from "./module-executor.ts";

export const HUB_V2 = "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8" as const;
export const ERC20_LIFT = "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5" as const;
export const VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110" as const;
export const BASE_GROUP = "0xC19BC204eb1c1D5B3FE500E5E5dfaBaB625F286c" as const;

const hubAbi = [
  {
    name: "calculateIssuance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "human", type: "address" }],
    outputs: [
      { name: "issuance", type: "uint256" },
      { name: "startPeriod", type: "uint256" },
      { name: "endPeriod", type: "uint256" },
    ],
  },
  {
    name: "personalMint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "wrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_avatar", type: "address" },
      { name: "_amount", type: "uint256" },
      { name: "_type", type: "uint8" },
    ],
    outputs: [],
  },
  {
    name: "unwrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "groupMint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_group", type: "address" },
      { name: "_collateralAvatars", type: "address[]" },
      { name: "_amounts", type: "uint256[]" },
      { name: "_data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "isTrusted",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "truster", type: "address" },
      { name: "trustee", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  // ERC-1155 balanceOf to check raw token balance in Hub
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ERC-20 wrapped personal token ABI (includes unwrap)
const wrappedPersonalTokenAbi = [
  {
    name: "unwrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [],
  },
] as const;

const erc20LiftAbi = [
  {
    name: "erc20Circles",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "circlesType", type: "uint8" },
      { name: "avatar", type: "address" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const erc20Abi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Check if a user's personal token type is trusted by BASE_GROUP.
 */
export async function isUserEligible(
  publicClient: PublicClient,
  userAddress: `0x${string}`,
): Promise<boolean> {
  return publicClient.readContract({
    address: HUB_V2,
    abi: hubAbi,
    functionName: "isTrusted",
    args: [BASE_GROUP, userAddress],
  });
}

/**
 * Get the mintable amount for a user (via calculateIssuance).
 */
export async function getMintableForUser(
  publicClient: PublicClient,
  userAddress: `0x${string}`,
): Promise<bigint> {
  const [issuance] = await publicClient.readContract({
    address: HUB_V2,
    abi: hubAbi,
    functionName: "calculateIssuance",
    args: [userAddress],
  });
  return issuance;
}

/**
 * Get the ERC-1155 balance of a user's personal token in the Hub.
 * Token ID = user address converted to uint256.
 */
export async function getErc1155PersonalBalance(
  publicClient: PublicClient,
  userAddress: `0x${string}`,
): Promise<bigint> {
  const tokenId = BigInt(userAddress);
  return publicClient.readContract({
    address: HUB_V2,
    abi: hubAbi,
    functionName: "balanceOf",
    args: [userAddress, tokenId],
  });
}

/**
 * Get the wrapped ERC-20 personal token address for a user (type=0).
 */
export async function getPersonalTokenAddress(
  publicClient: PublicClient,
  userAddress: `0x${string}`,
): Promise<`0x${string}`> {
  const address = await publicClient.readContract({
    address: ERC20_LIFT,
    abi: erc20LiftAbi,
    functionName: "erc20Circles",
    args: [0, userAddress],
  });
  return address as `0x${string}`;
}

/**
 * Get the wrapped ERC-20 group token address for BASE_GROUP (type=1, static/inflation-adjusted).
 */
export async function getGroupTokenAddress(
  publicClient: PublicClient,
): Promise<`0x${string}`> {
  const address = await publicClient.readContract({
    address: ERC20_LIFT,
    abi: erc20LiftAbi,
    functionName: "erc20Circles",
    args: [1, BASE_GROUP],
  });
  return address as `0x${string}`;
}

/**
 * Get the demurrage group token address for BASE_GROUP (type=0, gCRC).
 * This is different from the static group token (s-gCRC).
 */
export async function getDemurrageGroupTokenAddress(
  publicClient: PublicClient,
): Promise<`0x${string}`> {
  const address = await publicClient.readContract({
    address: ERC20_LIFT,
    abi: erc20LiftAbi,
    functionName: "erc20Circles",
    args: [0, BASE_GROUP],
  });
  return address as `0x${string}`;
}

/**
 * Get the wrapped ERC-20 balance for a token at a given address.
 */
export async function getWrappedBalance(
  publicClient: PublicClient,
  token: `0x${string}`,
  account: `0x${string}`,
): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
}

/**
 * Encode just the personalMint call.
 */
export function encodeMint(): ModuleTransaction {
  return {
    to: HUB_V2,
    value: 0n,
    data: encodeFunctionData({ abi: hubAbi, functionName: "personalMint" }),
  };
}

/**
 * Encode unwrap of wrapped personal ERC-20 tokens back to ERC-1155.
 */
export function encodeUnwrapPersonalTokens(
  personalToken: `0x${string}`,
  amount: bigint,
): ModuleTransaction {
  const unwrapData = encodeFunctionData({
    abi: wrappedPersonalTokenAbi,
    functionName: "unwrap",
    args: [amount],
  });
  return { to: personalToken, value: 0n, data: unwrapData };
}

/**
 * Encode groupMint → wrap(group) → approve batch.
 * Uses groupMint to directly convert ERC-1155 personal tokens to group tokens.
 * This is simpler than operateFlowMatrix and works when the group trusts the user.
 */
export function encodeGroupMintAndApprove(
  userAddress: `0x${string}`,
  convertAmount: bigint,
  groupToken: `0x${string}`,
  approveAmount: bigint,
): ModuleTransaction[] {
  const txs: ModuleTransaction[] = [];

  // 1. groupMint — mint group tokens using user's personal tokens as collateral
  const groupMintData = encodeFunctionData({
    abi: hubAbi,
    functionName: "groupMint",
    args: [
      BASE_GROUP,
      [userAddress], // User's own personal token as collateral
      [convertAmount],
      "0x", // No extra data
    ],
  });
  txs.push({ to: HUB_V2, value: 0n, data: groupMintData });

  // 2. wrap as group ERC-20 (type=1)
  const wrapData = encodeFunctionData({
    abi: hubAbi,
    functionName: "wrap",
    args: [BASE_GROUP, convertAmount, 1],
  });
  txs.push({ to: HUB_V2, value: 0n, data: wrapData });

  // 3. Approve group token for vault relayer
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [VAULT_RELAYER, approveAmount],
  });
  txs.push({ to: groupToken, value: 0n, data: approveData });

  return txs;
}

/**
 * Encode operateFlowMatrix → wrap(group) → approve batch.
 * For converting ERC-1155 personal tokens directly to group ERC-20 tokens.
 */
export function encodeErc1155ToGroupConversion(
  flowMatrix: {
    flowVertices: string[];
    flowEdges: { streamSinkId: number; amount: string }[];
    streams: { sourceCoordinate: number; flowEdgeIds: number[]; data: string }[];
    packedCoordinates: string;
  },
  convertAmount: bigint,
  groupToken: `0x${string}`,
  approveAmount: bigint,
): ModuleTransaction[] {
  const txs: ModuleTransaction[] = [];

  // 1. operateFlowMatrix — transfer ERC-1155 personal tokens through trust graph to BASE_GROUP
  const flowData = encodeFunctionData({
    abi: hubAbi,
    functionName: "operateFlowMatrix",
    args: [
      flowMatrix.flowVertices as `0x${string}`[],
      flowMatrix.flowEdges.map((e) => ({
        streamSinkId: e.streamSinkId,
        amount: BigInt(e.amount),
      })),
      flowMatrix.streams.map((s) => ({
        sourceCoordinate: s.sourceCoordinate,
        flowEdgeIds: s.flowEdgeIds,
        data: (s.data || "0x") as `0x${string}`,
      })),
      flowMatrix.packedCoordinates as `0x${string}`,
    ],
  });
  txs.push({ to: HUB_V2, value: 0n, data: flowData });

  // 2. wrap as group ERC-20 (type=1)
  const wrapData = encodeFunctionData({
    abi: hubAbi,
    functionName: "wrap",
    args: [BASE_GROUP, convertAmount, 1],
  });
  txs.push({ to: HUB_V2, value: 0n, data: wrapData });

  // 3. Approve group token for vault relayer
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [VAULT_RELAYER, approveAmount],
  });
  txs.push({ to: groupToken, value: 0n, data: approveData });

  return txs;
}

/**
 * Encode unwrap(personal ERC-20) → operateFlowMatrix → wrap(group) → approve batch.
 * For converting existing wrapped personal ERC-20 tokens to group tokens.
 */
export function encodePersonalToGroupConversion(
  flowMatrix: {
    flowVertices: string[];
    flowEdges: { streamSinkId: number; amount: string }[];
    streams: { sourceCoordinate: number; flowEdgeIds: number[]; data: string }[];
    packedCoordinates: string;
  },
  personalToken: `0x${string}`,
  personalTokenBalance: bigint,
  totalConvertAmount: bigint,
  groupToken: `0x${string}`,
  approveAmount: bigint,
): ModuleTransaction[] {
  const txs: ModuleTransaction[] = [];

  // 1. Unwrap personal ERC-20 tokens back to ERC-1155 in the Hub
  // The personal token's unwrap function converts ERC-20 back to ERC-1155
  const unwrapData = encodeFunctionData({
    abi: wrappedPersonalTokenAbi,
    functionName: "unwrap",
    args: [personalTokenBalance],
  });
  txs.push({ to: personalToken, value: 0n, data: unwrapData });

  // 2. operateFlowMatrix — transfer personal ERC-1155 tokens through trust graph to BASE_GROUP
  const flowData = encodeFunctionData({
    abi: hubAbi,
    functionName: "operateFlowMatrix",
    args: [
      flowMatrix.flowVertices as `0x${string}`[],
      flowMatrix.flowEdges.map((e) => ({
        streamSinkId: e.streamSinkId,
        amount: BigInt(e.amount),
      })),
      flowMatrix.streams.map((s) => ({
        sourceCoordinate: s.sourceCoordinate,
        flowEdgeIds: s.flowEdgeIds,
        data: (s.data || "0x") as `0x${string}`,
      })),
      flowMatrix.packedCoordinates as `0x${string}`,
    ],
  });
  txs.push({ to: HUB_V2, value: 0n, data: flowData });

  // 3. wrap as group ERC-20 (type=1)
  const wrapData = encodeFunctionData({
    abi: hubAbi,
    functionName: "wrap",
    args: [BASE_GROUP, totalConvertAmount, 1],
  });
  txs.push({ to: HUB_V2, value: 0n, data: wrapData });

  // 4. Approve group token for vault relayer
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [VAULT_RELAYER, approveAmount],
  });
  txs.push({ to: groupToken, value: 0n, data: approveData });

  return txs;
}

/**
 * Encode operateFlowMatrix → wrap(BASE_GROUP, amount, 1) → approve batch.
 * Converts personal ERC-1155 tokens to group ERC-20 via trust path, then approves for CoW.
 */
export function encodeFlowWrapApprove(
  flowMatrix: {
    flowVertices: string[];
    flowEdges: { streamSinkId: number; amount: string }[];
    streams: { sourceCoordinate: number; flowEdgeIds: number[]; data: string }[];
    packedCoordinates: string;
  },
  wrapAmount: bigint,
  groupToken: `0x${string}`,
  approveAmount: bigint,
): ModuleTransaction[] {
  // 1. operateFlowMatrix — transfer personal tokens through trust graph to BASE_GROUP
  const flowData = encodeFunctionData({
    abi: hubAbi,
    functionName: "operateFlowMatrix",
    args: [
      flowMatrix.flowVertices as `0x${string}`[],
      flowMatrix.flowEdges.map((e) => ({
        streamSinkId: e.streamSinkId,
        amount: BigInt(e.amount),
      })),
      flowMatrix.streams.map((s) => ({
        sourceCoordinate: s.sourceCoordinate,
        flowEdgeIds: s.flowEdgeIds,
        data: (s.data || "0x") as `0x${string}`,
      })),
      flowMatrix.packedCoordinates as `0x${string}`,
    ],
  });

  // 2. wrap as group ERC-20 (type=1)
  const wrapData = encodeFunctionData({
    abi: hubAbi,
    functionName: "wrap",
    args: [BASE_GROUP, wrapAmount, 1],
  });

  // 3. Approve group token for vault relayer
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [VAULT_RELAYER, approveAmount],
  });

  return [
    { to: HUB_V2, value: 0n, data: flowData },
    { to: HUB_V2, value: 0n, data: wrapData },
    { to: groupToken, value: 0n, data: approveData },
  ];
}

/**
 * Encode just an approve for the vault relayer (for existing balances, no mint needed).
 */
export function encodeApproveOnly(
  token: `0x${string}`,
  amount: bigint,
): ModuleTransaction[] {
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [VAULT_RELAYER, amount],
  });
  return [{ to: token, value: 0n, data: approveData }];
}

/**
 * Encode unwrap of demurrage group token (gCRC, type 0) back to ERC-1155.
 * The wrapped token's unwrap function converts ERC-20 back to ERC-1155.
 */
export function encodeUnwrapDemurrageGroupToken(
  demurrageGroupToken: `0x${string}`,
  amount: bigint,
): ModuleTransaction {
  const unwrapData = encodeFunctionData({
    abi: wrappedPersonalTokenAbi, // Same unwrap signature
    functionName: "unwrap",
    args: [amount],
  });
  return { to: demurrageGroupToken, value: 0n, data: unwrapData };
}

/**
 * Encode conversion of demurrage group tokens (gCRC) to static group tokens (s-gCRC).
 * Unwraps gCRC back to ERC-1155, then wraps as s-gCRC (type 1).
 */
export function encodeConvertDemurrageToStatic(
  demurrageGroupToken: `0x${string}`,
  amount: bigint,
): ModuleTransaction[] {
  const txs: ModuleTransaction[] = [];

  // 1. Unwrap gCRC (demurrage) back to ERC-1155 group tokens
  const unwrapData = encodeFunctionData({
    abi: wrappedPersonalTokenAbi,
    functionName: "unwrap",
    args: [amount],
  });
  txs.push({ to: demurrageGroupToken, value: 0n, data: unwrapData });

  // 2. Wrap as s-gCRC (static, type=1)
  const wrapData = encodeFunctionData({
    abi: hubAbi,
    functionName: "wrap",
    args: [BASE_GROUP, amount, 1],
  });
  txs.push({ to: HUB_V2, value: 0n, data: wrapData });

  return txs;
}

/**
 * Encode a USDC transfer as a ModuleTransaction.
 */
export function encodeUsdcTransfer(
  usdcAddress: `0x${string}`,
  recipient: `0x${string}`,
  amount: bigint,
): ModuleTransaction {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, amount],
  });
  return { to: usdcAddress, value: 0n, data };
}
