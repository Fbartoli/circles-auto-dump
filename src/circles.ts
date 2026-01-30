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
    name: "operateFlowMatrix",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_flowVertices", type: "address[]" },
      {
        name: "_flow",
        type: "tuple[]",
        components: [
          { name: "streamSinkId", type: "uint16" },
          { name: "amount", type: "uint192" },
        ],
      },
      {
        name: "_streams",
        type: "tuple[]",
        components: [
          { name: "sourceCoordinate", type: "uint16" },
          { name: "flowEdgeIds", type: "uint16[]" },
          { name: "data", type: "bytes" },
        ],
      },
      { name: "_packedCoordinates", type: "bytes" },
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
 * Get the wrapped ERC-20 group token address for BASE_GROUP (type=1).
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
