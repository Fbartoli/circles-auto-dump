# Quickstart: Circles Auto-Dump Service

**Branch**: `001-circles-auto-dump` | **Date**: 2026-01-23

## Prerequisites

- [Bun](https://bun.sh) v1.0+ installed
- A Gnosis Chain wallet with:
  - A private key (hex, 0x-prefixed)
  - Some xDAI for gas fees (~0.1 xDAI sufficient for many cycles)
  - A registered Circles V2 avatar with personal token minting enabled

## Setup

```bash
# Clone and install
git clone <repo-url> && cd circles-auto-dump
git checkout 001-circles-auto-dump
bun install
```

## Configuration

Create a `.env` file (Bun loads it automatically):

```env
# Required
PRIVATE_KEY=0x<your-64-char-hex-private-key>
AVATAR_ADDRESS=0x<your-circles-avatar-address>

# Optional (defaults shown)
RPC_URL=https://rpc.aboutcircles.com
INTERVAL_MS=3600000
MIN_SWAP_AMOUNT_CRC=1.0
SLIPPAGE_BPS=300
COW_APP_CODE=circles-auto-dump
PORT=3000
```

## Run

```bash
# Start the service
bun run index.ts

# Or with hot-reload during development
bun --hot index.ts
```

## Verify

```bash
# Check health endpoint
curl http://localhost:3000/health
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Bun.serve() (HTTP)                     │
│                   GET /health                            │
└─────────────────────────────────────────────────────────┘
                           │
                    reads ServiceState
                           │
┌─────────────────────────────────────────────────────────┐
│                   Cycle Scheduler                        │
│              (setInterval, hourly default)               │
└─────────────────────────────────────────────────────────┘
                           │
                    executes cycle
                           │
┌─────────────────────────────────────────────────────────┐
│                    Cycle Pipeline                        │
│                                                         │
│  1. Check mintable amount (Circles SDK)                 │
│  2. Mint CRC tokens (Circles SDK)                       │
│  3. Wrap CRC → ERC20 static (Circles SDK)               │
│  4. Approve ERC20 for CoW Vault Relayer                 │
│  5. Submit sell order (CoW TradingSdk)                   │
│  6. Poll order status until filled/expired              │
└─────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
    ┌─────────┴─────────┐    ┌─────────┴─────────┐
    │   Circles SDK      │    │   CoW Protocol     │
    │   (Gnosis Chain)   │    │   (Gnosis Chain)   │
    │                    │    │                    │
    │  Hub V2 Contract   │    │  OrderBook API     │
    │  ERC20 Wrapper     │    │  GPv2Settlement    │
    └────────────────────┘    └────────────────────┘
```

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@aboutcircles/sdk` | latest | Circles avatar & minting |
| `@aboutcircles/sdk-core` | latest | Contract abstractions |
| `@aboutcircles/sdk-types` | latest | TypeScript types |
| `@cowprotocol/cow-sdk` | latest | CoW TradingSdk |
| `@cowprotocol/sdk-viem-adapter` | latest | Viem adapter for CoW |
| `viem` | latest | Ethereum client |

## Cycle Flow (Detailed)

1. **Check mintable**: `avatar.personalToken.getAvailableAmount()` → if 0, skip
2. **Mint**: `avatar.personalToken.mint()` → get tx receipt
3. **Get wrapper address**: `sdk.core.liftERC20.erc20Circles(CirclesType.Inflation, avatarAddress)`
4. **Wrap**: `avatar.wrap.asInflationary(avatarAddress, mintedAmount)` → ERC20 balance
5. **Check approval**: `cowSdk.getCowProtocolAllowance(wrappedTokenAddress)`
6. **Approve if needed**: `cowSdk.approveCowProtocol(wrappedTokenAddress, amount)`
7. **Submit order**: `cowSdk.postSwapOrder({ kind: SELL, sellToken: wrapped, buyToken: USDC, amount })`
8. **Poll status**: Check order every 30s for up to 10 minutes
9. **Log result**: Record amounts, tx hashes, order status
