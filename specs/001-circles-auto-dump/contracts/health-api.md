# Health API Contract

**Base URL**: `http://localhost:{PORT}`

This service exposes a single HTTP endpoint for operational health monitoring. No authentication required (bind to localhost or internal network only).

## Endpoints

### GET /health

Returns current service status and last cycle result.

**Response**: `200 OK` (always, even if last cycle errored — the service itself is healthy)

```json
{
  "status": "ok",
  "uptime": 86400,
  "startedAt": "2026-01-23T00:00:00.000Z",
  "isCycleInProgress": false,
  "totalCycles": 24,
  "successfulCycles": 22,
  "lastCycle": {
    "startedAt": "2026-01-23T23:00:00.000Z",
    "completedAt": "2026-01-23T23:01:30.000Z",
    "status": "success",
    "mintableAmount": "1000000000000000000",
    "mintedAmount": "1000000000000000000",
    "mintTxHash": "0xabc...def",
    "wrappedAmount": "1000000000000000000",
    "wrapTxHash": "0x123...456",
    "swapOrderId": "0x789...abc",
    "swapStatus": "filled",
    "usdcReceived": "950000",
    "error": null,
    "errorStep": null
  }
}
```

**Response when no cycles have run yet**:

```json
{
  "status": "ok",
  "uptime": 5,
  "startedAt": "2026-01-23T00:00:00.000Z",
  "isCycleInProgress": false,
  "totalCycles": 0,
  "successfulCycles": 0,
  "lastCycle": null
}
```

**Response fields**:

| Field | Type | Description |
|-------|------|-------------|
| status | `"ok"` | Service health (always "ok" if responding) |
| uptime | number | Seconds since service started |
| startedAt | string (ISO 8601) | Service start timestamp |
| isCycleInProgress | boolean | Whether a cycle is currently executing |
| totalCycles | number | Total cycles attempted |
| successfulCycles | number | Cycles that completed with status "success" |
| lastCycle | CycleResult \| null | Most recent cycle result (null if none yet) |

### GET /

Redirects to `/health` (convenience).

**Response**: `302 Found` with `Location: /health`
