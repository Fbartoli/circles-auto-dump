import type { OrderBookApi } from "@cowprotocol/cow-sdk";
import type { PublicClient, WalletClient } from "viem";
import type { Configuration, RegisteredUser, UserCycleResult, MultiCycleResult } from "./types.ts";
import { isModuleEnabled, execViaModule, execSingleViaModule } from "./module-executor.ts";
import {
  getMintableForUser,
  getGroupTokenAddress,
  getDemurrageGroupTokenAddress,
  getPersonalTokenAddress,
  getWrappedBalance,
  getErc1155PersonalBalance,
  encodeMint,
  encodeUnwrapPersonalTokens,
  encodeGroupMintAndApprove,
  encodeConvertDemurrageToStatic,
  encodeApproveOnly,
  encodeErc20Transfer,
} from "./circles.ts";
import {
  EURE_GNOSIS,
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

  // 2. Get group token addresses (both types), personal token address, and all balances
  const groupToken = await getGroupTokenAddress(publicClient); // s-gCRC (type 1)
  const demurrageGroupToken = await getDemurrageGroupTokenAddress(publicClient); // gCRC (type 0)
  const personalToken = await getPersonalTokenAddress(publicClient, userAddress);

  // Check if personal token is deployed (non-zero address)
  const zeroAddress = "0x0000000000000000000000000000000000000000" as `0x${string}`;
  const hasPersonalToken = personalToken !== zeroAddress;
  const hasDemurrageGroupToken = demurrageGroupToken !== zeroAddress;

  const [existingGroupBalance, demurrageGroupBalance, erc1155PersonalBalance, wrappedPersonalBalance, mintableAmount] = await Promise.all([
    getWrappedBalance(publicClient, groupToken, userAddress), // s-gCRC
    hasDemurrageGroupToken ? getWrappedBalance(publicClient, demurrageGroupToken, userAddress) : Promise.resolve(0n), // gCRC
    getErc1155PersonalBalance(publicClient, userAddress),
    hasPersonalToken ? getWrappedBalance(publicClient, personalToken, userAddress) : Promise.resolve(0n),
    getMintableForUser(publicClient, userAddress),
  ]);

  // Total amount to convert = ERC-1155 balance + wrapped personal ERC-20 + mintable (new UBI)
  // Note: wrapped personal ERC-20 must be unwrapped first, then all go through groupMint
  const amountToConvert = erc1155PersonalBalance + wrappedPersonalBalance + mintableAmount;

  // Total to sell = existing s-gCRC + gCRC (will be converted to s-gCRC) + personal tokens to convert
  // Everything ends up as s-gCRC for a single swap order
  const totalSellAmount = existingGroupBalance + demurrageGroupBalance + amountToConvert;
  const minSwapWei = BigInt(Math.floor(config.minSwapAmountCrc * 1e18));

  logger.info("User balances", {
    userAddress,
    existingGroupBalance: existingGroupBalance.toString(),
    demurrageGroupBalance: demurrageGroupBalance.toString(),
    erc1155PersonalBalance: erc1155PersonalBalance.toString(),
    wrappedPersonalBalance: wrappedPersonalBalance.toString(),
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

  // 3. Convert gCRC → s-gCRC (if needed) → Unwrap personal (if needed) → Mint (if needed) → groupMint → wrap → approve
  let mintTxHash: string | null = null;
  let finalSellAmount = totalSellAmount;
  try {
    // Step 0: Convert demurrage group tokens (gCRC) to static group tokens (s-gCRC)
    if (demurrageGroupBalance > 0n) {
      const convertTxs = encodeConvertDemurrageToStatic(demurrageGroupToken, demurrageGroupBalance);
      const convertTxHash = await execViaModule(walletClient, publicClient, userAddress, convertTxs);
      logger.info("Converted gCRC to s-gCRC", {
        userAddress,
        txHash: convertTxHash,
        amount: demurrageGroupBalance.toString(),
      });
    }

    if (amountToConvert > 0n) {
      // Step A: Unwrap wrapped personal ERC-20 tokens to ERC-1155 (if any)
      if (wrappedPersonalBalance > 0n) {
        const unwrapTx = encodeUnwrapPersonalTokens(personalToken, wrappedPersonalBalance);
        const unwrapTxHash = await execSingleViaModule(walletClient, publicClient, userAddress, unwrapTx);
        logger.info("Unwrapped personal ERC-20 to ERC-1155", {
          userAddress,
          txHash: unwrapTxHash,
          amount: wrappedPersonalBalance.toString(),
        });
      }

      // Step B: personalMint to get ERC-1155 tokens (if there's new UBI to claim)
      if (mintableAmount > 0n) {
        const mintTx = encodeMint();
        mintTxHash = await execSingleViaModule(walletClient, publicClient, userAddress, mintTx);
        logger.info("Personal mint executed", { userAddress, mintTxHash });
      }

      // Step C: groupMint → wrap → approve
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
    } else if (demurrageGroupBalance > 0n || existingGroupBalance > 0n) {
      // No personal conversion needed, just approve existing s-gCRC balance (including converted gCRC)
      const approveTxs = encodeApproveOnly(groupToken, totalSellAmount);
      mintTxHash = await execViaModule(walletClient, publicClient, userAddress, approveTxs);
      logger.info("Approve executed for existing group balance", { userAddress, mintTxHash, amount: totalSellAmount.toString() });
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
      const feeTx = encodeErc20Transfer(EURE_GNOSIS, config.feeRecipient, feeAmount);
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
