import {
  OrderBookApi,
  OrderQuoteSideKindSell,
  OrderStatus,
  SigningScheme,
  SupportedChainId,
  OrderKind,
} from "@cowprotocol/cow-sdk";
import { encodeFunctionData } from "viem";
import type { SwapStatus } from "./types.ts";
import type { ModuleTransaction } from "./module-executor.ts";
import { logger } from "./logger.ts";

export const EURE_GNOSIS = "0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430" as const;
export const GPV2_SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41" as const;

const POLL_INTERVAL_MS = 30_000;
const POLL_MAX_DURATION_MS = 600_000;

export const settlementAbi = [
  {
    name: "setPreSignature",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderUid", type: "bytes" },
      { name: "signed", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export interface OrderResult {
  status: SwapStatus;
  buyAmount: bigint | null;
}

export function createOrderBookApi(): OrderBookApi {
  return new OrderBookApi({ chainId: SupportedChainId.GNOSIS_CHAIN });
}

/**
 * Get a quote and submit a presign order. `from` is the address that holds the sell token
 * (the user's Safe in multi-user mode).
 */
export async function getQuoteAndSubmitOrder(
  orderBookApi: OrderBookApi,
  from: `0x${string}`,
  sellToken: `0x${string}`,
  sellAmount: bigint,
  slippageBps: number,
): Promise<string> {
  logger.info("Getting quote from CoW Protocol", {
    from,
    sellToken,
    sellAmount: sellAmount.toString(),
    buyToken: EURE_GNOSIS,
  });

  let quoteResponse;
  try {
    quoteResponse = await orderBookApi.getQuote({
      kind: OrderQuoteSideKindSell.SELL,
      sellToken,
      buyToken: EURE_GNOSIS,
      sellAmountBeforeFee: sellAmount.toString(),
      from,
      signingScheme: SigningScheme.PRESIGN,
    });
  } catch (err: any) {
    const body = err?.body ?? err?.response?.body ?? err?.message;
    logger.error("Quote request failed", { error: body, details: JSON.stringify(err, null, 2).slice(0, 2000) });
    throw err;
  }

  const quote = quoteResponse.quote;
  const quotedBuyAmount = BigInt(quote.buyAmount);
  const minBuyAmount = quotedBuyAmount - (quotedBuyAmount * BigInt(slippageBps)) / 10000n;

  logger.info("Quote received", {
    quotedBuyAmount: quotedBuyAmount.toString(),
    minBuyAmount: minBuyAmount.toString(),
    slippageBps,
    validTo: quote.validTo,
  });

  const orderPayload = {
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    sellAmount: quote.sellAmount,
    buyAmount: minBuyAmount.toString(),
    validTo: quote.validTo,
    feeAmount: "0",
    kind: OrderKind.SELL,
    partiallyFillable: false,
    signingScheme: SigningScheme.PRESIGN,
    signature: from,
    from,
    receiver: from,
    appData: quote.appData,
    quoteId: quoteResponse.id,
  };

  logger.info("Submitting order", { orderPayload });

  let orderId: string;
  try {
    orderId = await orderBookApi.sendOrder(orderPayload);
  } catch (err: any) {
    const body = err?.body ?? err?.response?.body ?? err?.message;
    logger.error("Order submission failed", { error: body, details: JSON.stringify(err, null, 2).slice(0, 1000) });
    throw err;
  }

  logger.info("Order submitted with presign scheme", { orderId });
  return orderId;
}

/**
 * Encode a presign transaction as a ModuleTransaction (to be executed on user's Safe via module).
 */
export function encodePresign(orderUid: string): ModuleTransaction {
  const data = encodeFunctionData({
    abi: settlementAbi,
    functionName: "setPreSignature",
    args: [orderUid as `0x${string}`, true],
  });
  return { to: GPV2_SETTLEMENT, value: 0n, data };
}

/**
 * Poll order status until filled, expired, or timeout.
 */
export async function pollOrderStatus(orderBookApi: OrderBookApi, orderId: string): Promise<OrderResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_MAX_DURATION_MS) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const order = await orderBookApi.getOrder(orderId);
      const status = order.status;

      if (status === OrderStatus.FULFILLED) {
        const buyAmount = order.executedBuyAmount ? BigInt(order.executedBuyAmount) : null;
        logger.info("Order filled", { orderId, buyAmount: buyAmount?.toString() });
        return { status: "filled", buyAmount };
      }

      if (status === OrderStatus.CANCELLED) {
        logger.warn("Order cancelled", { orderId });
        return { status: "cancelled", buyAmount: null };
      }

      if (status === OrderStatus.EXPIRED) {
        logger.warn("Order expired", { orderId });
        return { status: "expired", buyAmount: null };
      }

      logger.debug("Order still pending", { orderId, status });
    } catch (err) {
      logger.warn("Error polling order status", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.warn("Order polling timed out", { orderId });
  return { status: "expired", buyAmount: null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
