# Data Model: Circles Auto-Dump Service

**Branch**: `001-circles-auto-dump` | **Date**: 2026-01-23

## Entities

### Configuration

Environment-driven settings loaded at startup. No persistence required.

| Field | Type | Source | Default | Description |
|-------|------|--------|---------|-------------|
| privateKey | `0x${string}` | `PRIVATE_KEY` env | required | Wallet private key for signing transactions |
| rpcUrl | string | `RPC_URL` env | `https://rpc.aboutcircles.com` | Gnosis Chain RPC endpoint |
| avatarAddress | `0x${string}` | `AVATAR_ADDRESS` env | required | Circles avatar address to mint for |
| intervalMs | number | `INTERVAL_MS` env | `3600000` (1 hour) | Cycle interval in milliseconds |
| minSwapAmountCrc | number | `MIN_SWAP_AMOUNT_CRC` env | `1.0` | Minimum CRC balance to trigger swap |
| slippageBps | number | `SLIPPAGE_BPS` env | `300` (3%) | Slippage tolerance in basis points |
| cowAppCode | string | `COW_APP_CODE` env | `circles-auto-dump` | App identifier for CoW Protocol |
| port | number | `PORT` env | `3000` | HTTP health endpoint port |

### CycleResult

In-memory record of the last completed cycle. Exposed via health endpoint.

| Field | Type | Description |
|-------|------|-------------|
| startedAt | Date | When the cycle began |
| completedAt | Date | When the cycle finished |
| status | `'success' \| 'skipped' \| 'error'` | Cycle outcome |
| mintableAmount | bigint \| null | CRC available to mint (atto-circles) |
| mintedAmount | bigint \| null | CRC actually minted (atto-circles) |
| mintTxHash | string \| null | Mint transaction hash |
| wrappedAmount | bigint \| null | Amount wrapped to ERC20 |
| wrapTxHash | string \| null | Wrap transaction hash |
| swapOrderId | string \| null | CoW Protocol order UID |
| swapStatus | `'filled' \| 'expired' \| 'pending' \| null` | CoW order settlement status |
| usdcReceived | bigint \| null | USDC amount received (6 decimals) |
| error | string \| null | Error message if status is 'error' |
| errorStep | `'mint' \| 'wrap' \| 'approve' \| 'swap' \| 'poll' \| null` | Which step failed |

### ServiceState

Global service state exposed via health endpoint.

| Field | Type | Description |
|-------|------|-------------|
| startedAt | Date | When the service started |
| isRunning | boolean | Whether the service is active |
| isCycleInProgress | boolean | Mutex flag preventing concurrent runs |
| totalCycles | number | Total cycles executed |
| successfulCycles | number | Cycles that completed successfully |
| lastCycle | CycleResult \| null | Most recent cycle result |

## State Transitions

### Cycle Lifecycle

```
IDLE → MINTING → WRAPPING → APPROVING → SWAPPING → POLLING → COMPLETE
  ↑                                                              |
  └──────────────────── (wait interval) ←────────────────────────┘

Error at any step → log error → set status='error' → COMPLETE
Skip (no mintable / below threshold) → set status='skipped' → COMPLETE
```

### CoW Order States

```
SUBMITTED → PENDING → FILLED (success)
                    → EXPIRED (retain tokens, try next cycle)
                    → CANCELLED (retain tokens, try next cycle)
```

## Relationships

```
Configuration ──creates──→ ServiceState (1:1, at startup)
ServiceState ──contains──→ CycleResult (1:1, latest only)
CycleResult ──references──→ Configuration (reads thresholds)
```

## Validation Rules

- `privateKey` must be a valid 64-character hex string prefixed with `0x`
- `avatarAddress` must be a valid Ethereum address (checksummed)
- `intervalMs` must be >= 60000 (1 minute minimum)
- `minSwapAmountCrc` must be > 0
- `slippageBps` must be between 10 (0.1%) and 5000 (50%)
- `port` must be between 1 and 65535
