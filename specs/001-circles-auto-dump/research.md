# Research: Circles Auto-Dump Service

**Branch**: `001-circles-auto-dump` | **Date**: 2026-01-23

## Decision 1: Token Minting API

**Decision**: Use the Circles SDK (`@aboutcircles/sdk`) high-level avatar interface for minting.

**Rationale**: The SDK provides `avatar.personalToken.getAvailableAmount()` (returns `bigint` of mintable CRC) and `avatar.personalToken.mint()` (returns `ContractTransactionReceipt`). This is simpler than calling Hub V2 contract methods directly and handles gas estimation internally.

**Alternatives considered**:
- Direct Hub V2 contract calls via `sdk.v2Hub.calculateIssuance()` — lower-level, requires manual transaction construction, but gives more control over gas parameters.
- Using `@aboutcircles/sdk-core` `Core` class with `core.hubV2.calculateIssuance(address)` — mid-level, as shown in the example code. Returns `[amount, startPeriod, endPeriod]`.

**Implementation note**: The SDK example uses `Core` class directly (`core.hubV2.calculateIssuance`), but the high-level `Sdk` class with `getAvatar()` → `avatar.personalToken.mint()` is the recommended approach per the SDK interface docs.

## Decision 2: ERC1155 → ERC20 Wrapping (Critical for CoW Swap)

**Decision**: Wrap minted CRC (ERC1155) tokens into **inflationary/static** ERC20 wrapper before submitting to CoW Protocol.

**Rationale**: Circles V2 personal tokens are ERC1155 tokens managed within the Hub contract. CoW Protocol only supports ERC20 tokens. Per the [Circles wrapping docs](https://docs.aboutcircles.com/circles-sdk/wrapping-and-unwrapping), the **inflationary/static** wrapper is explicitly recommended for "AMM liquidity, lending collateral, and bridges" because "balances remain fixed (no decay)" and it "prevents decay-related incompatibilities." This ensures the wrapped balance doesn't decay between wrapping and CoW order settlement.

**SDK Methods**:
- Wrap: `await avatar.wrap.asInflationary(avatar.address, amount)` — returns transaction receipt
- Get wrapper address: `await sdk.core.liftERC20.erc20Circles(CirclesType.Inflation, avatar.address)`
- Unwrap (if needed): `await avatar.wrap.unwrapInflationary(wrapperAddress, amount)`

**Alternatives considered**:
- Demurraged ERC20 wrapper (`asDemurraged`) — preserves decay mechanics but causes balance to decrease between wrap and swap, leading to potential order failures or underfilled amounts.
- Direct ERC1155 transfer to a DEX — not supported by CoW Protocol or standard AMMs.

**Key addresses**:
- Circles Hub V2: `0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8`
- Circles RPC: `https://rpc.aboutcircles.com`

## Decision 3: CoW Protocol Integration

**Decision**: Use `@cowprotocol/cow-sdk` (`TradingSdk`) with `@cowprotocol/sdk-viem-adapter` for order submission.

**Rationale**: The TradingSdk handles quote fetching, EIP-712 signing, fee calculation, and order posting in a single `postSwapOrder()` call. Using the viem adapter aligns with the Circles SDK's viem dependency.

**Key details**:
- Chain: `SupportedChainId.GNOSIS_CHAIN` (chain ID 100)
- API endpoint: `https://api.cow.fi/xdai/api/v1`
- GPv2Settlement: `0x9008D19f58AAbD9eD0D60971565AA8510560ab41`
- GPv2 Vault Relayer (approval target): `0xC92E8bdf79f0507f65a392b0ab4667716BFE0110`

**Flow**:
1. Approve the wrapped ERC20 CRC token for the Vault Relayer contract
2. Call `sdk.postSwapOrder({ kind: OrderKind.SELL, sellToken: wrappedCRC, buyToken: USDC, ... })`
3. Wait for order settlement (poll order status or use order ID)

**Alternatives considered**:
- Lower-level `OrderBookApi` for manual quote + sign + submit — more control but more code.
- 1inch aggregator — better price discovery but adds external API dependency and no MEV protection.
- SushiSwap router — on-chain AMM swap, simpler but worse execution price and MEV-vulnerable.

## Decision 4: USDC Token on Gnosis Chain

**Decision**: Use bridged USDC at `0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83` (6 decimals).

**Rationale**: This is the established USDC token on Gnosis Chain with the most liquidity. It's the xDAI-bridged version from Ethereum mainnet.

**Alternatives considered**:
- Native Circle USDC (newer, less liquidity on Gnosis Chain currently).
- WXDAI (wrapped xDAI) — stable but less universally recognized as USDC.

## Decision 5: ContractRunner Implementation (Server-Side)

**Decision**: Implement a server-side `ContractRunner` using viem's `createWalletClient` with a private key account (not browser wallet).

**Rationale**: The SDK quickstart shows a browser-based runner. For a server-side daemon, we need to use `privateKeyToAccount()` from viem and construct a `WalletClient` with `http` transport instead of `custom(window.ethereum)`.

**Implementation pattern**:
```typescript
import { createPublicClient, createWalletClient, http, privateKeyToAccount } from 'viem';
import { gnosis } from 'viem/chains';

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: gnosis, transport: http(rpcUrl) });
const walletClient = createWalletClient({ chain: gnosis, transport: http(rpcUrl), account });
```

## Decision 6: Runtime & Framework

**Decision**: Use Bun with `Bun.serve()` for the HTTP health endpoint and `setInterval` / timer-based scheduling for hourly cycles.

**Rationale**: Per project CLAUDE.md, Bun is the default runtime. `Bun.serve()` provides a lightweight HTTP server for the health endpoint without needing Express or other frameworks. Bun natively supports TypeScript and loads `.env` files automatically.

**Alternatives considered**:
- Node.js with cron library — adds unnecessary dependency, project mandates Bun.
- Separate cron job calling a script — loses in-process state and health endpoint capability.

## Decision 7: Order Settlement Monitoring

**Decision**: Poll CoW Protocol order status after submission to confirm settlement or detect expiry.

**Rationale**: CoW Protocol orders are not immediately settled — they go through a batch auction. The service needs to know whether the order was filled (USDC received) or expired (tokens still held). The `OrderBookApi.getOrder(orderId)` method provides order status.

**Polling strategy**: Check every 30 seconds for up to 10 minutes (CoW orders typically settle within 1-5 minutes). If expired/cancelled, log and retain tokens for next cycle.

## Key Contract Addresses (Gnosis Chain)

| Contract | Address |
|----------|---------|
| Circles Hub V2 | `0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8` |
| USDC (Bridged) | `0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83` |
| GPv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` |
| GPv2 Vault Relayer | `0xC92E8bdf79f0507f65a392b0ab4667716BFE0110` |

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@aboutcircles/sdk` | High-level Circles SDK |
| `@aboutcircles/sdk-core` | Core contract abstractions |
| `@aboutcircles/sdk-types` | TypeScript types |
| `@cowprotocol/cow-sdk` | CoW Protocol TradingSdk |
| `@cowprotocol/sdk-viem-adapter` | Viem adapter for CoW SDK |
| `viem` | Ethereum client library |
