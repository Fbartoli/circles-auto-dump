export interface Configuration {
  privateKey: `0x${string}`;
  rpcUrl: string;
  intervalMs: number;
  minSwapAmountCrc: number;
  slippageBps: number;
  cowAppCode: string;
  port: number;
  feeRecipient: `0x${string}`;
  feeBps: number;
  dbPath: string;
  programAddress: `0x${string}`;
}

export type CycleStatus = "success" | "skipped" | "error";
export type ErrorStep = "mint" | "swap" | "presign" | "poll" | "fee";
export type SwapStatus = "filled" | "expired" | "pending" | "cancelled";
export type UserStatus = "active" | "paused" | "ineligible";

export interface RegisteredUser {
  address: `0x${string}`;
  registeredAt: Date;
  status: UserStatus;
  lastProcessedAt: Date | null;
  totalUsdcReceived: bigint;
  totalFeePaid: bigint;
  processCount: number;
}

export interface UserCycleResult {
  userAddress: `0x${string}`;
  startedAt: Date;
  completedAt: Date;
  status: CycleStatus;
  mintedAmount: bigint | null;
  mintTxHash: string | null;
  swapOrderId: string | null;
  swapStatus: SwapStatus | null;
  usdcReceived: bigint | null;
  feeAmount: bigint | null;
  feeTxHash: string | null;
  error: string | null;
  errorStep: ErrorStep | null;
}

export interface MultiCycleResult {
  startedAt: Date;
  completedAt: Date;
  usersProcessed: number;
  usersSucceeded: number;
  usersFailed: number;
  usersSkipped: number;
  totalUsdcDistributed: bigint;
  totalFeesCollected: bigint;
  userResults: UserCycleResult[];
}
