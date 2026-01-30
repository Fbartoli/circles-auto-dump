# Tasks: Circles Auto-Dump Service

**Input**: Design documents from `/specs/001-circles-auto-dump/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included as optional tasks in the Polish phase (not explicitly requested as TDD).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and dependency installation

- [x] T001 Create src/ and tests/ directories per plan.md structure
- [x] T002 Install dependencies: @aboutcircles/sdk, @aboutcircles/sdk-core, @aboutcircles/sdk-types, @cowprotocol/cow-sdk, @cowprotocol/sdk-viem-adapter, viem in package.json
- [x] T003 Update tsconfig.json to include src/ directory and set strict mode

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, configuration, and logging that ALL user stories depend on

- [x] T004 [P] Define TypeScript types (Configuration, CycleResult, ServiceState) in src/types.ts per data-model.md entities
- [x] T005 [P] Implement structured logger with timestamp, level, and context fields in src/logger.ts
- [x] T006 Implement environment variable loader with validation rules from data-model.md in src/config.ts (depends on T004 for Configuration type)

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Automated Token Minting (Priority: P1) MVP

**Goal**: Automatically detect and mint claimable CRC tokens for the configured avatar

**Independent Test**: Run the service once and verify mintable tokens are detected; if >0, a mint transaction is submitted on-chain and a tx hash is returned

### Implementation for User Story 1

- [x] T007 [US1] Implement server-side ContractRunner using viem privateKeyToAccount + createWalletClient in src/circles.ts (per research.md Decision 5)
- [x] T008 [US1] Implement Circles SDK initialization (new Sdk with circlesConfig[100] and ContractRunner) in src/circles.ts
- [x] T009 [US1] Implement getMintableAmount helper wrapping avatar.personalToken.getAvailableAmount() in src/circles.ts
- [x] T010 [US1] Implement mintTokens helper wrapping avatar.personalToken.mint() in src/circles.ts
- [x] T011 [US1] Implement mint step in cycle pipeline: check mintable → mint → update CycleResult in src/cycle.ts
- [x] T012 [US1] Handle zero-mintable case: log skip and set status='skipped' in src/cycle.ts
- [x] T013 [US1] Handle mint transaction failure: catch error, set errorStep='mint', log details in src/cycle.ts

**Checkpoint**: User Story 1 fully functional — service can detect and mint CRC tokens independently

---

## Phase 4: User Story 2 - Automated Swap to USDC (Priority: P2)

**Goal**: Wrap minted CRC as ERC20, approve for CoW Protocol, submit sell order, poll until filled

**Independent Test**: Given a CRC balance, verify the service wraps tokens, submits a CoW order, and USDC is received upon settlement

### Implementation for User Story 2

- [x] T014 [US2] Implement getWrappedTokenAddress using sdk.core.liftERC20.erc20Circles(CirclesType.Inflation, avatarAddress) in src/circles.ts
- [x] T015 [US2] Implement wrapAsInflationary helper wrapping avatar.wrap.asInflationary() in src/circles.ts
- [x] T016 [US2] Implement CoW TradingSdk initialization with ViemAdapter and SupportedChainId.GNOSIS_CHAIN in src/cow.ts (per research.md Decision 3)
- [x] T017 [US2] Implement checkAndApproveToken helper using cowSdk.getCowProtocolAllowance() and cowSdk.approveCowProtocol() in src/cow.ts
- [x] T018 [US2] Implement submitSellOrder helper using cowSdk.postSwapOrder() with OrderKind.SELL, sellToken=wrappedCRC, buyToken=USDC address in src/cow.ts
- [x] T019 [US2] Implement pollOrderStatus helper: check order every 30s for up to 10 minutes, return filled/expired/cancelled in src/cow.ts (per research.md Decision 7)
- [x] T020 [US2] Implement minimum threshold check: skip swap if balance < config.minSwapAmountCrc, log reason in src/cycle.ts
- [x] T021 [US2] Implement wrap + approve + swap + poll steps in cycle pipeline after mint step in src/cycle.ts
- [x] T022 [US2] Handle swap failures: catch errors at each sub-step (wrap/approve/swap/poll), set appropriate errorStep in src/cycle.ts
- [x] T023 [US2] Handle order expiry/cancellation: log outcome, retain tokens for next cycle in src/cycle.ts

**Checkpoint**: User Stories 1 AND 2 both work — full mint-to-USDC pipeline functional

---

## Phase 5: User Story 3 - Persistent Long-Running Service (Priority: P3)

**Goal**: Run continuously with hourly scheduling, health endpoint, concurrency guard, and graceful error recovery

**Independent Test**: Start the service and observe it survives multiple cycles, responds to health checks, and recovers from transient errors

### Implementation for User Story 3

- [x] T024 [P] [US3] Implement health endpoint using Bun.serve() with GET /health and GET / (302 redirect) in src/health.ts (per contracts/health-api.md)
- [x] T025 [P] [US3] Implement ServiceState management: startedAt, totalCycles, successfulCycles, lastCycle tracking in src/health.ts
- [x] T026 [US3] Implement cycle scheduler: setInterval with config.intervalMs, run first cycle immediately on startup in index.ts
- [x] T027 [US3] Implement concurrency guard: isCycleInProgress mutex flag preventing overlapping runs in index.ts
- [x] T028 [US3] Implement graceful error recovery: wrap entire cycle in try/catch, update ServiceState, continue to next cycle in index.ts
- [x] T029 [US3] Wire up full entry point: load config → init Circles SDK → init CoW SDK → start health server → start scheduler in index.ts

**Checkpoint**: Service runs as a daemon, executes cycles on schedule, exposes health endpoint, survives errors

---

## Phase 6: User Story 4 - Operational Visibility (Priority: P4)

**Goal**: Structured logging of all cycle outcomes with amounts, tx hashes, and error details

**Independent Test**: Run a cycle and verify log output contains timestamp, mintable/minted amounts, wrapped amount, swap order ID, USDC received, and any errors with step identification

### Implementation for User Story 4

- [x] T030 [US4] Add structured cycle-start log (cycle number, timestamp) in src/cycle.ts
- [x] T031 [US4] Add structured mint-result log (mintableAmount, mintedAmount, mintTxHash) in src/cycle.ts
- [x] T032 [US4] Add structured swap-result log (wrappedAmount, swapOrderId, swapStatus, usdcReceived) in src/cycle.ts
- [x] T033 [US4] Add structured error log with errorStep and error message in src/cycle.ts
- [x] T034 [US4] Add cycle-complete summary log (status, duration, all amounts) in src/cycle.ts

**Checkpoint**: All cycle outcomes are fully observable through structured logs

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Tests, edge case hardening, and validation

- [x] T035 Add config validation tests (valid/invalid env vars, defaults, boundary values) in tests/config.test.ts
- [x] T036 Add health endpoint tests (response format, uptime, lastCycle states) in tests/health.test.ts
- [x] T037 Add cycle logic tests with mocked Circles SDK and CoW SDK calls in tests/cycle.test.ts
- [x] T038 Add .env.example file with documented configuration variables at project root
- [x] T039 Validate end-to-end quickstart.md flow (install → configure → run → health check)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) completion - BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational (Phase 2) - No dependencies on other stories
- **US2 (Phase 4)**: Depends on Foundational (Phase 2) + US1 (Phase 3) mint logic exists in circles.ts
- **US3 (Phase 5)**: Depends on Foundational (Phase 2) - Can proceed in parallel with US1/US2 for health endpoint, but needs cycle.ts for full integration
- **US4 (Phase 6)**: Depends on Foundational (Phase 2) - Can proceed once logger is ready, but logging calls target cycle.ts steps from US1/US2
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Start after Phase 2 — fully independent
- **User Story 2 (P2)**: Start after US1 — builds on minted tokens, extends cycle.ts pipeline
- **User Story 3 (P3)**: Start after Phase 2 — health endpoint is independent; scheduler wraps cycle from US1+US2
- **User Story 4 (P4)**: Start after Phase 2 — adds logging calls throughout cycle steps from US1+US2

### Recommended Execution Order (single developer)

1. Phase 1 → Phase 2 → Phase 3 (US1) → Phase 4 (US2) → Phase 5 (US3) → Phase 6 (US4) → Phase 7

### Within Each User Story

- Types/helpers before pipeline integration
- Pipeline logic before error handling
- Core path before edge cases

### Parallel Opportunities

Within Phase 2:
- T004 (types) and T005 (logger) can run in parallel

Within Phase 5 (US3):
- T024 (health endpoint) and T025 (ServiceState) can run in parallel

**Note**: Tests and on-chain transaction tasks run sequentially to avoid nonce conflicts.

---

## Parallel Example: User Story 3

```bash
# Launch parallel tasks (different files, no on-chain interaction):
Task: "Implement health endpoint in src/health.ts"
Task: "Implement ServiceState management in src/health.ts"

# Then sequentially (scheduler + wiring):
Task: "Implement cycle scheduler in index.ts"
Task: "Implement concurrency guard in index.ts"
Task: "Wire up full entry point in index.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (types, config, logger)
3. Complete Phase 3: User Story 1 (mint CRC tokens)
4. **STOP and VALIDATE**: Run service, verify mintable detection and mint tx submission
5. Deploy/demo if ready — already delivering value (no missed issuance)

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (mint) → Test independently → Deploy (MVP: never miss CRC minting!)
3. Add US2 (swap) → Test independently → Deploy (Full pipeline: CRC → USDC)
4. Add US3 (daemon) → Test independently → Deploy (Production-ready service)
5. Add US4 (logging) → Test independently → Deploy (Observable production service)
6. Polish → Final hardening and tests

---

## Notes

- [P] tasks = different files or different functions, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Key contract addresses are in research.md — reference during implementation
- Bun loads .env automatically — no dotenv needed
- Use `Bun.serve()` for HTTP, not Express
