import { findPath, createFlowMatrix } from "@circles-sdk/pathfinder";
import { BASE_GROUP } from "./circles.ts";
import { logger } from "./logger.ts";

const CIRCLES_RPC_URL = "https://rpc.aboutcircles.com/";

export interface FlowMatrixData {
  flowVertices: string[];
  flowEdges: { streamSinkId: number; amount: string }[];
  streams: { sourceCoordinate: number; flowEdgeIds: number[]; data: string }[];
  packedCoordinates: string;
  /** The actual amount that will be transferred (may be less than requested due to trust path limits) */
  actualFlowAmount: bigint;
}

/**
 * Find the trust path from a user to BASE_GROUP and return encoded flow matrix data.
 * Uses the Circles v2 pathfinder to find how personal tokens can flow to the group.
 */
export async function findFlowToGroup(
  userAddress: `0x${string}`,
  amount: bigint,
): Promise<FlowMatrixData> {
  logger.info("Finding trust path to group", {
    from: userAddress,
    to: BASE_GROUP,
    amount: amount.toString(),
  });

  const path = await findPath(CIRCLES_RPC_URL, {
    from: userAddress,
    to: BASE_GROUP,
    targetFlow: amount.toString(),
  });

  if (!path.transfers || path.transfers.length === 0) {
    throw new Error(`No trust path found from ${userAddress} to ${BASE_GROUP}`);
  }

  const maxFlow = BigInt(path.maxFlow);
  if (maxFlow < amount) {
    logger.warn("Max flow less than requested amount, using max flow", {
      requested: amount.toString(),
      maxFlow: maxFlow.toString(),
    });
  }

  const flowAmount = maxFlow < amount ? maxFlow : amount;

  logger.info("Path found", {
    transfers: path.transfers.length,
    maxFlow: path.maxFlow,
    flowAmount: flowAmount.toString(),
  });

  const matrix = createFlowMatrix(
    userAddress,
    BASE_GROUP,
    flowAmount.toString(),
    path.transfers,
  );

  return {
    flowVertices: matrix.flowVertices,
    flowEdges: matrix.flowEdges.map((e: any) => ({
      streamSinkId: Number(e.streamSinkId),
      amount: e.amount.toString(),
    })),
    streams: matrix.streams.map((s: any) => ({
      sourceCoordinate: Number(s.sourceCoordinate),
      flowEdgeIds: s.flowEdgeIds.map(Number),
      data: s.data instanceof Uint8Array
        ? (s.data.length === 0 ? "0x" : "0x" + Buffer.from(s.data).toString("hex"))
        : (s.data || "0x"),
    })),
    packedCoordinates: matrix.packedCoordinates,
    actualFlowAmount: flowAmount,
  };
}
