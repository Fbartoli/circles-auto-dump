import type { OrderBookApi } from "@cowprotocol/cow-sdk";
import type { PublicClient, WalletClient } from "viem";
import type { Configuration, RegisteredUser, UserCycleResult, MultiCycleResult } from "./types.ts";
import { isModuleEnabled, execViaModule, execSingleViaModule } from "./module-executor.ts";
import {
  getMintableForUser,
  getGroupTokenAddress,
  getWrappedBalance,
  encodeMint,
  encodeFlowWrapApprove,
  encodeApproveOnly,
  encodeUsdcTransfer,
} from "./circles.ts";
import { findFlowToGroup } from "./pathfinder.ts";
import {
  USDC_GNOSIS,
  getQuoteAndSubmitOrder,
  encodePresign,
  pollOrderStatus,
} from "./cow.ts";
import { recordUserCycle, updateUserStatus } from "./db.ts";
import { logger } from "./logger.ts";


export async function executeMultiUserCycle(
  config: Configuration,
  walletClient: WalletClient,
  publicClient: PublicClient,
  orderBookApi: OrderBookApi,
  users: RegisteredUser[],
): Promise<MultiCycleResult> {
  const startedAt = new Date();
  const userResults: UserCycleResult[] = [];
  let usersSucceeded = 0;
  let usersFailed = 0;
  let usersSkipped = 0;
  let totalUsdcDistributed = 0n;
  let totalFeesCollected = 0n;

  logger.info("Starting multi-user cycle", { userCount: users.length });

  // Process users sequentially to avoid nonce issues
  for (const user of users) {
    try {
      const result = await processUser(config, walletClient, publicClient, orderBookApi, user);
      userResults.push(result);
      recordUserCycle(result);

      if (result.status === "success") {
        usersSucceeded++;
        totalUsdcDistributed += result.usdcReceived ?? 0n;
        totalFeesCollected += result.feeAmount ?? 0n;
      } else if (result.status === "skipped") {
        usersSkipped++;
      } else {
        usersFailed++;
      }
    } catch (err) {
      usersFailed++;
      const errorResult: UserCycleResult = {
        userAddress: user.address,
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
        error: err instanceof Error ? err.message : String(err),
        errorStep: null,
      };
      userResults.push(errorResult);
      recordUserCycle(errorResult);
      logger.error("Unexpected error processing user", {
        user: user.address,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const completedAt = new Date();
  const result: MultiCycleResult = {
    startedAt,
    completedAt,
    usersProcessed: users.length,
    usersSucceeded,
    usersFailed,
    usersSkipped,
    totalUsdcDistributed,
    totalFeesCollected,
    userResults,
  };

  logger.info("Multi-user cycle complete", {
    usersProcessed: users.length,
    usersSucceeded,
    usersFailed,
    usersSkipped,
    totalUsdcDistributed: totalUsdcDistributed.toString(),
    totalFeesCollected: totalFeesCollected.toString(),
  });

  return result;
}

async function processUser(
  config: Configuration,
  walletClient: WalletClient,
  publicClient: PublicClient,
  orderBookApi: OrderBookApi,
  user: RegisteredUser,
): Promise<UserCycleResult> {
  const startedAt = new Date();
  const userAddress = user.address;

  logger.info("Processing user", { userAddress });

  // 1. Check module is still enabled
  const moduleEnabled = await isModuleEnabled(publicClient, userAddress, config.programAddress);
  if (!moduleEnabled) {
    logger.warn("Module no longer enabled for user, marking ineligible", { userAddress });
    updateUserStatus(userAddress, "ineligible");
    return {
      userAddress,
      startedAt,
      completedAt: new Date(),
      status: "skipped",
      mintedAmount: null,
      mintTxHash: null,
      swapOrderId: null,
      swapStatus: null,
      usdcReceived: null,
      feeAmount: null,
      feeTxHash: null,
      error: "Module not enabled",
      errorStep: null,
    };
  }

  // 2. Get group token address, existing balance, and mintable amount
  const groupToken = await getGroupTokenAddress(publicClient);
  const [existingGroupBalance, mintableAmount] = await Promise.all([
    getWrappedBalance(publicClient, groupToken, userAddress),
    getMintableForUser(publicClient, userAddress),
  ]);

  const totalSellAmount = existingGroupBalance + mintableAmount;
  const minSwapWei = BigInt(Math.floor(config.minSwapAmountCrc * 1e18));

  logger.info("User balances", {
    userAddress,
    existingGroupBalance: existingGroupBalance.toString(),
    mintableAmount: mintableAmount.toString(),
    totalSellAmount: totalSellAmount.toString(),
  });

  if (totalSellAmount < minSwapWei) {
    logger.info("Total sell amount below threshold, skipping", {
      userAddress,
      totalSellAmount: totalSellAmount.toString(),
      threshold: minSwapWei.toString(),
    });
    return {
      userAddress,
      startedAt,
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
    };
  }

  // 3. Mint → find trust path → flow to group → wrap → approve
  let mintTxHash: string | null = null;
  try {
    if (mintableAmount > 0n) {
      // Step A: personalMint to get ERC-1155 tokens
      const mintTx = encodeMint();
      mintTxHash = await execSingleViaModule(walletClient, publicClient, userAddress, mintTx);
      logger.info("Personal mint executed", { userAddress, mintTxHash });

      // Step B: Find trust path from user to BASE_GROUP via Circles pathfinder
      const flowMatrix = await findFlowToGroup(userAddress, mintableAmount);

      // Step C: operateFlowMatrix + wrap(group) + approve — all in one batch
      const batchTxs = encodeFlowWrapApprove(flowMatrix, mintableAmount, groupToken, totalSellAmount);
      const flowTxHash = await execViaModule(walletClient, publicClient, userAddress, batchTxs);
      logger.info("Flow + wrap + approve executed", {
        userAddress,
        flowTxHash,
        mintedAmount: mintableAmount.toString(),
        approvedAmount: totalSellAmount.toString(),
      });
    } else {
      // No mint needed, just approve existing group balance
      const approveTxs = encodeApproveOnly(groupToken, existingGroupBalance);
      mintTxHash = await execViaModule(walletClient, publicClient, userAddress, approveTxs);
      logger.info("Approve executed for existing group balance", { userAddress, mintTxHash });
    }
  } catch (err) {
    logger.error("Mint/flow/approve failed", { userAddress, error: err instanceof Error ? err.message : String(err) });
    return {
      userAddress,
      startedAt,
      completedAt: new Date(),
      status: "error",
      mintedAmount: null,
      mintTxHash: null,
      swapOrderId: null,
      swapStatus: null,
      usdcReceived: null,
      feeAmount: null,
      feeTxHash: null,
      error: err instanceof Error ? err.message : String(err),
      errorStep: "mint",
    };
  }

  // 4. Submit CoW order for group token
  let orderId: string;
  try {
    orderId = await getQuoteAndSubmitOrder(
      orderBookApi,
      userAddress,
      groupToken,
      totalSellAmount,
      config.slippageBps,
    );
    logger.info("Order submitted", { userAddress, orderId, sellAmount: totalSellAmount.toString() });
  } catch (err) {
    logger.error("Swap order submission failed", { userAddress, error: err instanceof Error ? err.message : String(err) });
    return {
      userAddress,
      startedAt,
      completedAt: new Date(),
      status: "error",
      mintedAmount: mintableAmount,
      mintTxHash,
      swapOrderId: null,
      swapStatus: null,
      usdcReceived: null,
      feeAmount: null,
      feeTxHash: null,
      error: err instanceof Error ? err.message : String(err),
      errorStep: "swap",
    };
  }

  // 5. Execute presign on user's Safe
  try {
    const presignTx = encodePresign(orderId);
    await execSingleViaModule(walletClient, publicClient, userAddress, presignTx);
    logger.info("Presign executed", { userAddress, orderId });
  } catch (err) {
    logger.error("Presign failed", { userAddress, error: err instanceof Error ? err.message : String(err) });
    return {
      userAddress,
      startedAt,
      completedAt: new Date(),
      status: "error",
      mintedAmount: mintableAmount,
      mintTxHash,
      swapOrderId: orderId,
      swapStatus: null,
      usdcReceived: null,
      feeAmount: null,
      feeTxHash: null,
      error: err instanceof Error ? err.message : String(err),
      errorStep: "presign",
    };
  }

  // 6. Poll order status
  const orderResult = await pollOrderStatus(orderBookApi, orderId);

  if (orderResult.status !== "filled" || !orderResult.buyAmount) {
    logger.warn("Order not filled", { userAddress, orderId, status: orderResult.status });
    return {
      userAddress,
      startedAt,
      completedAt: new Date(),
      status: "skipped",
      mintedAmount: mintableAmount,
      mintTxHash,
      swapOrderId: orderId,
      swapStatus: orderResult.status,
      usdcReceived: null,
      feeAmount: null,
      feeTxHash: null,
      error: null,
      errorStep: null,
    };
  }

  // 7. Calculate and execute fee transfer
  const usdcReceived = orderResult.buyAmount;
  const feeAmount = (usdcReceived * BigInt(config.feeBps)) / 10000n;

  let feeTxHash: string | null = null;
  if (feeAmount > 0n) {
    try {
      const feeTx = encodeUsdcTransfer(USDC_GNOSIS, config.feeRecipient, feeAmount);
      feeTxHash = await execSingleViaModule(walletClient, publicClient, userAddress, feeTx);
      logger.info("Fee transfer executed", {
        userAddress,
        feeAmount: feeAmount.toString(),
        feeTxHash,
      });
    } catch (err) {
      logger.error("Fee transfer failed", { userAddress, error: err instanceof Error ? err.message : String(err) });
      return {
        userAddress,
        startedAt,
        completedAt: new Date(),
        status: "error",
        mintedAmount: mintableAmount,
        mintTxHash,
        swapOrderId: orderId,
        swapStatus: "filled",
        usdcReceived,
        feeAmount,
        feeTxHash: null,
        error: err instanceof Error ? err.message : String(err),
        errorStep: "fee",
      };
    }
  }

  return {
    userAddress,
    startedAt,
    completedAt: new Date(),
    status: "success",
    mintedAmount: mintableAmount,
    mintTxHash,
    swapOrderId: orderId,
    swapStatus: "filled",
    usdcReceived,
    feeAmount,
    feeTxHash,
    error: null,
    errorStep: null,
  };
}
