import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gnosis } from "viem/chains";
import { loadConfig } from "./src/config.ts";
import { initDatabase } from "./src/db.ts";
import { createOrderBookApi } from "./src/cow.ts";
import { getActiveUsers } from "./src/db.ts";
import { executeMultiUserCycle } from "./src/multi-cycle.ts";
import { startApiServer, setCycleInProgress, recordCycleComplete, getApiState } from "./src/api.ts";
import { logger } from "./src/logger.ts";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

async function main() {
  const config = loadConfig();

  // Ensure data directory exists
  mkdirSync(dirname(config.dbPath), { recursive: true });

  logger.info("Initializing database...", { dbPath: config.dbPath });
  initDatabase(config.dbPath);

  const account = privateKeyToAccount(config.privateKey);

  const publicClient = createPublicClient({
    chain: gnosis,
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: gnosis,
    transport: http(config.rpcUrl),
  });

  const orderBookApi = createOrderBookApi();

  logger.info("Program EOA address", { programAddress: config.programAddress });

  async function runCycle() {
    const apiState = getApiState();
    if (apiState.isCycleInProgress) {
      logger.warn("Cycle already in progress, skipping");
      return;
    }

    const users = getActiveUsers();
    if (users.length === 0) {
      logger.info("No active users, skipping cycle");
      return;
    }

    setCycleInProgress(true);
    try {
      const result = await executeMultiUserCycle(config, walletClient, publicClient, orderBookApi, users);
      recordCycleComplete(result);
      logger.info("Cycle complete", {
        usersProcessed: result.usersProcessed,
        usersSucceeded: result.usersSucceeded,
        usersFailed: result.usersFailed,
        usersSkipped: result.usersSkipped,
      });
    } catch (err) {
      logger.error("Unexpected cycle error", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCycleInProgress(false);
    }
  }

  // Start API server
  logger.info("Starting API server...", { port: config.port });
  startApiServer(config, walletClient, publicClient, orderBookApi);

  // Run first cycle
  await runCycle();

  // Schedule subsequent cycles
  setInterval(runCycle, config.intervalMs);

  logger.info("Service started", {
    intervalMs: config.intervalMs,
    programAddress: config.programAddress,
    port: config.port,
  });
}

main().catch((err) => {
  logger.error("Fatal error during startup", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
