# Feature Specification: Circles Auto-Dump Service

**Feature Branch**: `001-circles-auto-dump`
**Created**: 2026-01-23
**Status**: Draft
**Input**: User description: "A long-running service that leverages the Circles SDK to fetch claimable tokens, mint them, and sell them for USDC on an hourly schedule."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automated Token Minting (Priority: P1)

As a Circles avatar owner, I want my claimable CRC tokens to be automatically minted on a regular schedule so that I never miss accumulating my daily issuance.

**Why this priority**: Minting is the prerequisite for all downstream value — if tokens aren't claimed, there's nothing to sell.

**Independent Test**: Can be fully tested by running the service and verifying that mintable tokens are detected and a mint transaction is submitted on-chain. Delivers value by ensuring no CRC issuance is left unclaimed.

**Acceptance Scenarios**:

1. **Given** the avatar has accumulated mintable CRC tokens, **When** the scheduled job runs, **Then** the system calculates the mintable amount and submits a mint transaction.
2. **Given** the avatar has zero mintable tokens, **When** the scheduled job runs, **Then** the system logs that no tokens are available and skips the mint step.
3. **Given** the mint transaction fails (e.g., insufficient gas), **When** the error occurs, **Then** the system logs the failure with details and retries on the next cycle.

---

### User Story 2 - Automated Swap to USDC (Priority: P2)

As a token holder, I want my freshly minted CRC tokens to be automatically sold for USDC so that I accumulate a stable-value asset without manual intervention.

**Why this priority**: Converting volatile CRC to USDC is the core value proposition — turning daily issuance into usable stablecoin.

**Independent Test**: Can be tested by providing the service with a CRC balance and verifying it executes a swap transaction that results in USDC being received in the configured wallet.

**Acceptance Scenarios**:

1. **Given** the wallet holds CRC tokens after minting, **When** the swap step executes, **Then** the system submits a signed order to CoW Protocol and the USDC is received in the wallet upon settlement.
2. **Given** the available CRC balance is below a configured minimum threshold, **When** the swap step runs, **Then** the system skips the swap to avoid uneconomical gas costs and logs the reason.
3. **Given** the swap transaction fails or receives excessive slippage, **When** the error occurs, **Then** the system logs the failure and retains the CRC tokens for the next cycle.

---

### User Story 3 - Persistent Long-Running Service (Priority: P3)

As an operator, I want the service to run continuously as a long-lived process (web server or background daemon) that executes the mint-and-swap cycle every hour, so I can deploy it and forget about it.

**Why this priority**: Without a reliable execution loop, the automation doesn't function — but the core logic (P1, P2) must work first.

**Independent Test**: Can be tested by starting the service and observing that it remains alive across multiple hourly cycles, executing the mint-and-swap flow each time and recovering from transient errors.

**Acceptance Scenarios**:

1. **Given** the service is started, **When** an hour elapses, **Then** the mint-and-swap cycle executes automatically.
2. **Given** the service encounters a transient error during a cycle, **When** the error is caught, **Then** the service logs the error and continues to the next scheduled cycle without crashing.
3. **Given** the service is running, **When** an operator requests health status (e.g., HTTP endpoint), **Then** the service responds with its current status and last cycle result.

---

### User Story 4 - Operational Visibility (Priority: P4)

As an operator, I want to see logs and status information about each mint-and-swap cycle so that I can monitor performance and troubleshoot issues.

**Why this priority**: Observability is important for production confidence but is supplementary to core functionality.

**Independent Test**: Can be tested by running a cycle and verifying structured log output includes timestamps, amounts minted, amounts swapped, transaction hashes, and any errors.

**Acceptance Scenarios**:

1. **Given** a successful mint-and-swap cycle completes, **When** I review the logs, **Then** I see the mintable amount, minted amount, swap input/output amounts, and transaction hashes.
2. **Given** a cycle encounters an error, **When** I review the logs, **Then** I see the error type, message, and which step failed.

---

### Edge Cases

- What happens when CoW Protocol cannot fill the order (insufficient liquidity or no solver picks it up)? The system should detect order expiry/cancellation and retain tokens for the next cycle.
- What happens if the private key or RPC endpoint becomes invalid? The system should log a critical error and continue retrying on subsequent cycles.
- What happens if the Circles protocol is paused or upgraded? The system should catch contract-level errors and log them without crashing.
- What happens if multiple cycles overlap (previous cycle still executing when next one triggers)? The system should prevent concurrent executions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST connect to the Gnosis Chain using a configured RPC endpoint and wallet private key.
- **FR-002**: System MUST query the Circles Hub V2 contract to calculate the current mintable CRC amount for the configured avatar address.
- **FR-003**: System MUST submit a mint transaction when the mintable amount is greater than zero.
- **FR-004**: System MUST swap minted CRC tokens for USDC via CoW Protocol (CoW Swap) on Gnosis Chain, using signed order intents submitted to the CoW Protocol API.
- **FR-005**: System MUST execute the mint-and-swap cycle on a configurable interval (default: every hour).
- **FR-006**: System MUST run as a long-lived process (web server or background daemon) that survives individual cycle failures.
- **FR-007**: System MUST log each cycle's outcome including amounts, transaction hashes, and any errors.
- **FR-008**: System MUST skip the swap step when the CRC balance is below a configurable minimum threshold.
- **FR-009**: System MUST prevent concurrent cycle executions (no overlapping runs).
- **FR-010**: System MUST expose a health-check endpoint (HTTP) reporting service status and last cycle result.
- **FR-011**: System MUST handle transaction failures gracefully without crashing, deferring to the next cycle.
- **FR-012**: System MUST load configuration from environment variables (private key, RPC URL, avatar address, interval, minimum swap threshold, slippage tolerance with a default of 3%).

### Key Entities

- **Avatar**: The Circles protocol identity (address) whose personal tokens are being minted. Owns a personal CRC token.
- **CRC Token**: The personal Circles token minted daily by an avatar. Represented in atto-circles (smallest unit) and human-readable CRC.
- **USDC**: The target stablecoin received after swapping CRC. ERC-20 token on Gnosis Chain.
- **Cycle**: A single execution of the mint-then-swap workflow. Has a start time, outcome (success/skip/error), and associated transaction hashes.
- **Configuration**: The set of environment variables controlling service behavior (wallet, RPC, thresholds, intervals).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The service successfully mints all available CRC tokens within each hourly cycle when tokens are mintable.
- **SC-002**: Minted CRC tokens are converted to USDC within the same cycle, with less than the configured slippage tolerance applied.
- **SC-003**: The service runs continuously for 7+ days without manual intervention or crashes.
- **SC-004**: Failed transactions do not halt the service — the next cycle executes on schedule.
- **SC-005**: An operator can determine service health and last cycle status within 5 seconds via the health endpoint.
- **SC-006**: All cycle outcomes (mint amounts, swap amounts, tx hashes, errors) are logged with timestamps for auditability.

## Assumptions

- The operator has a funded wallet on Gnosis Chain with sufficient native token (xDAI) for gas fees.
- CoW Protocol supports the CRC/USDC trading pair on Gnosis Chain (or can route through intermediate tokens).
- The configured avatar address is already registered with the Circles protocol and has personal token minting enabled.
- The Circles SDK (`@aboutcircles/sdk`) provides the necessary methods to calculate issuance and submit mint transactions.
- Environment variables are the appropriate configuration mechanism for this service (no GUI or config file needed).
- The service runs on a single instance (no multi-node coordination required).

## Clarifications

### Session 2026-01-23

- Q: Which DEX/swap protocol should be used for CRC→USDC swaps? → A: CoW Protocol (CoW Swap) — off-chain signed intents with batch auction settlement, providing MEV protection and gasless order submission.
- Q: What should the default slippage tolerance be? → A: 3% (balances fill rate against price protection for lower-liquidity personal tokens).
- Q: How should the wallet private key be managed? → A: Raw private key in environment variable (operator secures at infrastructure level).

## Out of Scope

- Multi-avatar support (minting for multiple addresses in one instance).
- Automatic wallet funding or gas management beyond checking balance.
- Price optimization or limit orders — the system swaps at market price within slippage tolerance.
- UI or dashboard — operational visibility is via logs and health endpoint only.
- Notification/alerting systems (email, Slack, etc.) — operators monitor logs directly.
