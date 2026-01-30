import type { PublicClient, WalletClient } from "viem";
import type { OrderBookApi } from "@cowprotocol/cow-sdk";
import type { Configuration, MultiCycleResult } from "./types.ts";
import { isUserEligible } from "./circles.ts";
import { isModuleEnabled } from "./module-executor.ts";
import { addUser, getUser, getActiveUsers, getAllUsers, updateUserStatus, getUserHistory } from "./db.ts";
import { executeMultiUserCycle } from "./multi-cycle.ts";
import { logger } from "./logger.ts";

const uiHtml = await Bun.file(new URL("./ui.html", import.meta.url).pathname).text();

interface ApiState {
  startedAt: Date;
  isCycleInProgress: boolean;
  totalCycles: number;
  lastCycleResult: MultiCycleResult | null;
}

const state: ApiState = {
  startedAt: new Date(),
  isCycleInProgress: false,
  totalCycles: 0,
  lastCycleResult: null,
};

export function startApiServer(
  config: Configuration,
  walletClient: WalletClient,
  publicClient: PublicClient,
  orderBookApi: OrderBookApi,
) {
  const server = Bun.serve({
    port: config.port,
    routes: {
      "/health": {
        GET: () => {
          return Response.json({
            status: "ok",
            uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
            startedAt: state.startedAt.toISOString(),
            isCycleInProgress: state.isCycleInProgress,
            totalCycles: state.totalCycles,
            lastCycle: state.lastCycleResult ? serializeCycleResult(state.lastCycleResult) : null,
            registeredUsers: getActiveUsers().length,
          });
        },
      },
      "/users": {
        GET: () => {
          const users = getAllUsers().map((u) => ({
            address: u.address,
            status: u.status,
            registeredAt: u.registeredAt.toISOString(),
            lastProcessedAt: u.lastProcessedAt?.toISOString() ?? null,
            totalUsdcReceived: u.totalUsdcReceived.toString(),
            totalFeePaid: u.totalFeePaid.toString(),
            processCount: u.processCount,
          }));
          return Response.json({ users });
        },
      },
      "/register": {
        POST: async (req) => {
          try {
            const body = (await req.json()) as { address?: string };
            const address = body?.address?.toLowerCase() as `0x${string}` | undefined;

            if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
              return Response.json({ error: "Invalid address" }, { status: 400 });
            }

            const existing = getUser(address);
            if (existing) {
              return Response.json({ error: "User already registered", user: serializeUser(existing) }, { status: 409 });
            }

            // Verify module is enabled on-chain
            const moduleEnabled = await isModuleEnabled(publicClient, address, config.programAddress);
            if (!moduleEnabled) {
              return Response.json({
                error: "Module not enabled. Add the program address as a module on your Safe first.",
                programAddress: config.programAddress,
              }, { status: 400 });
            }

            // Check eligibility
            const eligible = await isUserEligible(publicClient, address);
            if (!eligible) {
              return Response.json({
                error: "User token type not trusted by base group. Not eligible.",
              }, { status: 400 });
            }

            const user = addUser(address);
            logger.info("User registered", { address });
            return Response.json({ user: serializeUser(user) }, { status: 201 });
          } catch (err) {
            logger.error("Registration error", { error: err instanceof Error ? err.message : String(err) });
            return Response.json({ error: "Internal error" }, { status: 500 });
          }
        },
      },
      "/process": {
        POST: async () => {
          if (state.isCycleInProgress) {
            return Response.json({ error: "Cycle already in progress" }, { status: 409 });
          }

          const users = getActiveUsers();
          if (users.length === 0) {
            return Response.json({ message: "No active users to process" });
          }

          state.isCycleInProgress = true;
          try {
            const result = await executeMultiUserCycle(config, walletClient, publicClient, orderBookApi, users);
            state.totalCycles++;
            state.lastCycleResult = result;
            return Response.json(serializeCycleResult(result));
          } finally {
            state.isCycleInProgress = false;
          }
        },
      },
    },
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // /eligibility/:address
      const eligibilityMatch = path.match(/^\/eligibility\/(0x[0-9a-fA-F]{40})$/i);
      if (eligibilityMatch && req.method === "GET") {
        const address = eligibilityMatch[1]!.toLowerCase() as `0x${string}`;
        return handleEligibility(publicClient, config, address);
      }

      // /users/:address
      const userMatch = path.match(/^\/users\/(0x[0-9a-fA-F]{40})$/i);
      if (userMatch) {
        const address = userMatch[1]!.toLowerCase() as `0x${string}`;
        if (req.method === "GET") {
          return handleGetUser(address);
        }
        if (req.method === "DELETE") {
          return handlePauseUser(address);
        }
      }

      if (path === "/ui" && req.method === "GET") {
        return new Response(uiHtml, { headers: { "content-type": "text/html" } });
      }

      if (path === "/" && req.method === "GET") {
        return Response.redirect("/ui", 302);
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  logger.info("API server started", { port: config.port });
  return server;
}

export function getApiState(): ApiState {
  return state;
}

export function setCycleInProgress(value: boolean): void {
  state.isCycleInProgress = value;
}

export function recordCycleComplete(result: MultiCycleResult): void {
  state.totalCycles++;
  state.lastCycleResult = result;
}

async function handleEligibility(
  publicClient: PublicClient,
  config: Configuration,
  address: `0x${string}`,
): Promise<Response> {
  try {
    const [eligible, moduleEnabled] = await Promise.all([
      isUserEligible(publicClient, address),
      isModuleEnabled(publicClient, address, config.programAddress),
    ]);

    return Response.json({
      address,
      eligible,
      moduleEnabled,
      programAddress: config.programAddress,
      canRegister: eligible && moduleEnabled,
    });
  } catch (err) {
    logger.error("Eligibility check error", { address, error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "Failed to check eligibility" }, { status: 500 });
  }
}

function handleGetUser(address: `0x${string}`): Response {
  const user = getUser(address);
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const history = getUserHistory(address);
  return Response.json({
    user: serializeUser(user),
    history,
  });
}

function handlePauseUser(address: `0x${string}`): Response {
  const user = getUser(address);
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  updateUserStatus(address, "paused");
  logger.info("User paused", { address });
  return Response.json({ message: "User paused", address });
}

function serializeUser(user: any) {
  return {
    address: user.address,
    status: user.status,
    registeredAt: user.registeredAt instanceof Date ? user.registeredAt.toISOString() : user.registeredAt,
    lastProcessedAt: user.lastProcessedAt instanceof Date ? user.lastProcessedAt.toISOString() : user.lastProcessedAt,
    totalUsdcReceived: user.totalUsdcReceived?.toString() ?? "0",
    totalFeePaid: user.totalFeePaid?.toString() ?? "0",
    processCount: user.processCount ?? 0,
  };
}

function serializeCycleResult(result: MultiCycleResult) {
  return {
    startedAt: result.startedAt.toISOString(),
    completedAt: result.completedAt.toISOString(),
    usersProcessed: result.usersProcessed,
    usersSucceeded: result.usersSucceeded,
    usersFailed: result.usersFailed,
    usersSkipped: result.usersSkipped,
    totalUsdcDistributed: result.totalUsdcDistributed.toString(),
    totalFeesCollected: result.totalFeesCollected.toString(),
    userResults: result.userResults.map((r) => ({
      userAddress: r.userAddress,
      status: r.status,
      mintedAmount: r.mintedAmount?.toString() ?? null,
      mintTxHash: r.mintTxHash,
      swapOrderId: r.swapOrderId,
      swapStatus: r.swapStatus,
      usdcReceived: r.usdcReceived?.toString() ?? null,
      feeAmount: r.feeAmount?.toString() ?? null,
      feeTxHash: r.feeTxHash,
      error: r.error,
      errorStep: r.errorStep,
    })),
  };
}
