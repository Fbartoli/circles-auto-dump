import { Database } from "bun:sqlite";
import type { RegisteredUser, UserCycleResult, UserStatus } from "./types.ts";

let db: Database;

export function initDatabase(dbPath: string): Database {
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      address TEXT PRIMARY KEY,
      registered_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_processed_at TEXT,
      total_usdc_received TEXT DEFAULT '0',
      total_fee_paid TEXT DEFAULT '0',
      process_count INTEGER DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS process_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_address TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      minted_amount TEXT,
      mint_tx_hash TEXT,
      swap_order_id TEXT,
      swap_status TEXT,
      usdc_received TEXT,
      fee_amount TEXT,
      fee_tx_hash TEXT,
      error TEXT,
      error_step TEXT,
      FOREIGN KEY (user_address) REFERENCES users(address)
    )
  `);

  return db;
}

export function getDb(): Database {
  if (!db) throw new Error("Database not initialized. Call initDatabase first.");
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = undefined as any;
  }
}

export function addUser(address: `0x${string}`): RegisteredUser {
  const now = new Date().toISOString();
  getDb().run(
    "INSERT INTO users (address, registered_at, status) VALUES (?, ?, 'active')",
    [address.toLowerCase(), now],
  );
  return {
    address,
    registeredAt: new Date(now),
    status: "active",
    lastProcessedAt: null,
    totalUsdcReceived: 0n,
    totalFeePaid: 0n,
    processCount: 0,
  };
}

export function getUser(address: `0x${string}`): RegisteredUser | null {
  const row = getDb().query(
    "SELECT * FROM users WHERE address = ?",
  ).get(address.toLowerCase()) as any;
  if (!row) return null;
  return rowToUser(row);
}

export function getActiveUsers(): RegisteredUser[] {
  const rows = getDb().query(
    "SELECT * FROM users WHERE status = 'active'",
  ).all() as any[];
  return rows.map(rowToUser);
}

export function getAllUsers(): RegisteredUser[] {
  const rows = getDb().query("SELECT * FROM users").all() as any[];
  return rows.map(rowToUser);
}

export function updateUserStatus(address: `0x${string}`, status: UserStatus): void {
  getDb().run(
    "UPDATE users SET status = ? WHERE address = ?",
    [status, address.toLowerCase()],
  );
}

export function recordUserCycle(result: UserCycleResult): void {
  const d = getDb();

  d.run(
    `INSERT INTO process_log (user_address, started_at, completed_at, status, minted_amount, mint_tx_hash, swap_order_id, swap_status, usdc_received, fee_amount, fee_tx_hash, error, error_step)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      result.userAddress.toLowerCase(),
      result.startedAt.toISOString(),
      result.completedAt.toISOString(),
      result.status,
      result.mintedAmount?.toString() ?? null,
      result.mintTxHash,
      result.swapOrderId,
      result.swapStatus,
      result.usdcReceived?.toString() ?? null,
      result.feeAmount?.toString() ?? null,
      result.feeTxHash,
      result.error,
      result.errorStep,
    ],
  );

  if (result.status === "success") {
    d.run(
      `UPDATE users SET
        last_processed_at = ?,
        process_count = process_count + 1,
        total_usdc_received = CAST((CAST(total_usdc_received AS INTEGER) + ?) AS TEXT),
        total_fee_paid = CAST((CAST(total_fee_paid AS INTEGER) + ?) AS TEXT)
      WHERE address = ?`,
      [
        result.completedAt.toISOString(),
        (result.usdcReceived ?? 0n).toString(),
        (result.feeAmount ?? 0n).toString(),
        result.userAddress.toLowerCase(),
      ],
    );
  }
}

export function getUserHistory(address: `0x${string}`, limit = 20): any[] {
  return getDb().query(
    "SELECT * FROM process_log WHERE user_address = ? ORDER BY started_at DESC LIMIT ?",
  ).all(address.toLowerCase(), limit) as any[];
}

function rowToUser(row: any): RegisteredUser {
  return {
    address: row.address as `0x${string}`,
    registeredAt: new Date(row.registered_at),
    status: row.status as UserStatus,
    lastProcessedAt: row.last_processed_at ? new Date(row.last_processed_at) : null,
    totalUsdcReceived: BigInt(row.total_usdc_received || "0"),
    totalFeePaid: BigInt(row.total_fee_paid || "0"),
    processCount: row.process_count,
  };
}
