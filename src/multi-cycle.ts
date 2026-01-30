import type { OrderBookApi } from "@cowprotocol/cow-sdk";
import type { PublicClient, WalletClient } from "viem";
import type { Configuration, RegisteredUser, UserCycleResult, MultiCycleResult } from "./types.ts";
import { isModuleEnabled, execViaModule, execSingleViaModule } from "./module-executor.ts";
import {
  getMintableForUser,
  getGroupTokenAddress,
  getWrappedBalance,
  getErc1155PersonalBalance,
  encodeMint,
  encodeGroupMintAndApprove,
  encodeApproveOnly,
  encodeUsdcTransfer,
} from "./circles.ts";
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

  // 2. Get group token address and all balances
  const groupToken = await getGroupTokenAddress(publicClient);

  const [existingGroupBalance, erc1155PersonalBalance, mintableAmount] = await Promise.all([
    getWrappedBalance(publicClient, groupToken, userAddress),
    getErc1155PersonalBalance(publicClient, userAddress),
    getMintableForUser(publicClient, userAddress),
  ]);

  // Total amount to convert = ERC-1155 balance + mintable (new UBI)
  // Note: groupMint works directly with ERC-1155 personal tokens
  const amountToConvert = erc1155PersonalBalance + mintableAmount;
  // Total to sell = already group tokens + what we'll convert
  const totalSellAmount = existingGroupBalance + amountToConvert;
  const minSwapWei = BigInt(Math.floor(config.minSwapAmountCrc * 1e18));

  logger.info("User balances", {
    userAddress,
    existingGroupBalance: existingGroupBalance.toString(),
    erc1155PersonalBalance: erc1155PersonalBalance.toString(),
    mintableAmount: mintableAmount.toString(),
    amountToConvert: amountToConvert.toString(),
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

  // 3. Mint (if needed) → groupMint → wrap → approve
  let mintTxHash: string | null = null;
  let finalSellAmount = totalSellAmount;
  try {
    if (amountToConvert > 0n) {
      // Step A: personalMint to get ERC-1155 tokens (if there's new UBI to claim)
      if (mintableAmount > 0n) {
        const mintTx = encodeMint();
        mintTxHash = await execSingleViaModule(walletClient, publicClient, userAddress, mintTx);
        logger.info("Personal mint executed", { userAddress, mintTxHash });
      }

      // Step B: groupMint → wrap → approve
      // Uses groupMint which is simpler than operateFlowMatrix
      const batchTxs = encodeGroupMintAndApprove(
        userAddress,
        amountToConvert,
        groupToken,
        totalSellAmount,
      );
      const conversionTxHash = await execViaModule(walletClient, publicClient, userAddress, batchTxs);
      logger.info("Group mint + wrap + approve executed", {
        userAddress,
        txHash: conversionTxHash,
        convertAmount: amountToConvert.toString(),
        approvedAmount: totalSellAmount.toString(),
      });
    } else {
      // No conversion needed, just approve existing group balance
      const approveTxs = encodeApproveOnly(groupToken, existingGroupBalance);
      mintTxHash = await execViaModule(walletClient, publicClient, userAddress, approveTxs);
      logger.info("Approve executed for existing group balance", { userAddress, mintTxHash });
    }
  } catch (err) {
    logger.error("Mint/groupMint/approve failed", { userAddress, error: err instanceof Error ? err.message : String(err) });
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
      finalSellAmount,
      config.slippageBps,
    );
    logger.info("Order submitted", { userAddress, orderId, sellAmount: finalSellAmount.toString() });
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
