# Implementation Plan: Circles Auto-Dump Service

**Branch**: `001-circles-auto-dump` | **Date**: 2026-01-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-circles-auto-dump/spec.md`

## Summary

A long-running Bun service that automatically mints claimable Circles (CRC) tokens every hour, wraps them as static ERC20 tokens, and sells them for USDC via CoW Protocol on Gnosis Chain. Uses `Bun.serve()` for a health endpoint and `setInterval` for scheduling.

## Technical Context

**Language/Version**: TypeScript (Bun runtime)
**Primary Dependencies**: `@aboutcircles/sdk`, `@cowprotocol/cow-sdk`, `@cowprotocol/sdk-viem-adapter`, `viem`
**Storage**: N/A (in-memory state only)
**Testing**: `bun test`
**Target Platform**: Linux server (Gnosis Chain, chain ID 100)
**Project Type**: Single project (daemon with HTTP health endpoint)
**Performance Goals**: Complete mint-wrap-swap cycle within 10 minutes; health endpoint responds in <100ms
**Constraints**: Single avatar, single instance, <50MB memory
**Scale/Scope**: 1 user (operator), 24 cycles/day, ~1 CRC/hour minted

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No project-specific constitution defined (template only). No gates to enforce. Proceeding.

**Post-Phase 1 re-check**: Design uses minimal dependencies, flat file structure, no unnecessary abstractions. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-circles-auto-dump/
├── plan.md              # This file
├── research.md          # Phase 0: Technology research & decisions
├── data-model.md        # Phase 1: Entity definitions
├── quickstart.md        # Phase 1: Setup & run guide
├── contracts/           # Phase 1: API contracts
│   └── health-api.md    # Health endpoint specification
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── config.ts            # Environment variable loading & validation
├── cycle.ts             # Main mint-wrap-swap cycle logic
├── circles.ts           # Circles SDK initialization & minting helpers
├── cow.ts               # CoW Protocol SDK initialization & swap helpers
├── health.ts            # Bun.serve() health endpoint
├── logger.ts            # Structured logging utility
└── types.ts             # Shared TypeScript types (CycleResult, ServiceState)

tests/
├── config.test.ts       # Config validation tests
├── cycle.test.ts        # Cycle logic tests (mocked SDK calls)
└── health.test.ts       # Health endpoint response tests

index.ts                 # Entry point: init SDKs, start scheduler, start server
```

**Structure Decision**: Single flat `src/` directory — the service is small enough that models/services separation adds no value. Each file maps to one responsibility. Entry point at root level per existing `index.ts`.

## Complexity Tracking

No constitution violations to justify. Design is intentionally minimal:
- No database or persistence layer
- No abstraction layers beyond SDK wrappers
- No dependency injection or service locator patterns
- Single-file entry point orchestrating the cycle
