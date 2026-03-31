# REST API Plan

This document describes the REST API for the Cards MVP. It aligns with the PostgreSQL schema (including RLS), the product requirements, and the Astro + Supabase + OpenRouter stack. Spaced-repetition session state is **not** exposed via API in MVP (stored client-side only per PRD).

**Assumptions (where inputs are implicit):**

- API is **not** public: only first-party web clients; no third-party API keys or developer portal in MVP (PRD §4).
- Version prefix `/api/v1` is used for future evolution; Astro maps these to `src/pages/api/v1/...`.
- User registration, login, logout, password flows use **Supabase Auth** (hosted endpoints or JS SDK) rather than custom REST routes, except where a server wrapper is required (e.g. account deletion with service role).
- LLM calls use **OpenRouter** only on the server; the client never receives the OpenRouter API key.

---

## 1. Resources

| Resource | Database table(s) | Notes |
|----------|-------------------|--------|
| **Card** | `cards` | Persisted flashcards; `source` is `manual` or `ai_generated`. |
| **Generation session** | `generation_sessions` | One row per LLM response; metrics `input_length`, `generated_count`, `accepted_count`. |
| **Card proposal** | `card_proposals` | Child of a session; `position` unique per `session_id`. |
| **Generation statistics** | `generation_sessions` (aggregates) | Read-only aggregate view for PRD metrics; not a separate table. |
| **User / account** | `auth.users` (Supabase) | No `profiles` table in MVP; deletion cascades to `cards` and `generation_sessions` per FK. |

### Response envelope convention

- Default success shape uses `data` envelope (for example `{ "data": ... }`).
- Paginated endpoints use `{ "data": [...], "meta": { ... } }`.
- **Exception:** `GET /api/v1/health` returns a plain object `{ "status": "ok" }` (no `data` wrapper).

---

## 2. Endpoints

### 2.1 Cards (`cards`)

#### List cards

| | |
|---|---|
| **HTTP** | `GET` |
| **Path** | `/api/v1/cards` |
| **Description** | List the authenticated user’s cards (“Moje fiszki”), newest first by default. |

**Query parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `page` | integer | `1` | 1-based page index. |
| `limit` | integer | `20` | Page size (cap e.g. 100). |
| `sort` | string | `created_at_desc` | `created_at_desc` \| `created_at_asc` \| `updated_at_desc`. |
| `cursor` | string | — | Optional cursor for cursor-based pagination (alternative to `page`; if both sent, cursor wins). In cursor mode, `meta.page` remains a conventional value (`1`) for stable response shape. |

**Request body**

None.

**Response `200 OK`**

```json
{
  "data": [
    {
      "id": "uuid",
      "front": "string",
      "back": "string",
      "source": "manual",
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 123,
    "has_more": true
  }
}
```

**Success codes**

- `200` — List returned (possibly empty).

**Error codes**

| Code | When |
|------|------|
| `401` | Missing or invalid session / JWT. |
| `403` | Authenticated but not allowed (rare if RLS matches user). |
| `400` | Invalid `page`, `limit`, or `sort`. |
| `500` | Server or database error. |

---

#### Create cards (bulk)

| | |
|---|---|
| **HTTP** | `POST` |
| **Path** | `/api/v1/cards` |
| **Description** | Create one or more cards in a single request. Used for manual cards and for AI-generated cards accepted as-is or after editing. Client provides final `front`/`back`; server derives `source` per item from `proposal_id` (`proposal_id` present -> `ai_generated`, absent -> `manual`) and persists it. `proposal_id` is optional metadata linking to the originating `card_proposals` row. All items are inserted as a batch; if any item fails validation the entire request is rejected (400) before any insert. |

**Request body**

```json
{
  "cards": [
    {
      "front": "string",
      "back": "string",
      "proposal_id": "uuid | null"
    }
  ]
}
```

- `cards` — array, **1–50** items.
- `source` — not accepted from client. Server derives it per item: `manual` when `proposal_id` is missing, `ai_generated` when `proposal_id` is provided and valid.
- `proposal_id` — optional; when provided, the server verifies the proposal belongs to a session owned by the user and updates `generation_sessions.accepted_count` accordingly.
- `front` / `back` contain the final text (already edited by the user if applicable).

**Response `201 Created`**

```json
{
  "data": [
    {
      "id": "uuid",
      "front": "string",
      "back": "string",
      "source": "manual | ai_generated",
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  ]
}
```

Array order matches the request `cards` array order.

**Success codes**

- `201` — All cards created; response contains every created card.

**Error codes**

| Code | When |
|------|------|
| `401` | Unauthenticated. |
| `400` | Array empty, exceeds 50 items, or any item fails field validation (empty `front`/`back`, length limits). |
| `404` | A provided `proposal_id` does not exist or does not belong to the user. |
| `500` | Server/database error. |

**Validation (align with DB):**
- `front` required per item; `char_length(front) <= 200`.
- `back` required per item; `char_length(back) <= 500`.
- `source` is derived server-side (`manual` if `proposal_id` missing; `ai_generated` if `proposal_id` is present and valid).
- When `proposal_id` present: verify via `card_proposals` → `generation_sessions.user_id = auth.uid()` before insert; after successful insert increment `accepted_count` in the corresponding session(s).

---

#### Get card by ID

| | |
|---|---|
| **HTTP** | `GET` |
| **Path** | `/api/v1/cards/:cardId` |
| **Description** | Fetch a single card if it belongs to the user. |

**Response `200 OK`**

```json
{
  "data": {
    "id": "uuid",
    "front": "string",
    "back": "string",
    "source": "manual | ai_generated",
    "created_at": "ISO-8601",
    "updated_at": "ISO-8601"
  }
}
```

**Error codes**

| Code | When |
|------|------|
| `401` | Unauthenticated. |
| `404` | Card does not exist or not visible to user (avoid leaking existence across users). |
| `500` | Server error. |

---

#### Update card

| | |
|---|---|
| **HTTP** | `PATCH` |
| **Path** | `/api/v1/cards/:cardId` |
| **Description** | Update `front` and/or `back`; `updated_at` updated by DB trigger. |

**Request body** (partial)

```json
{
  "front": "string",
  "back": "string"
}
```

**Response `200 OK`**

```json
{
  "data": {
    "id": "uuid",
    "front": "string",
    "back": "string",
    "source": "manual | ai_generated",
    "created_at": "ISO-8601",
    "updated_at": "ISO-8601"
  }
}
```

**Error codes**

| Code | When |
|------|------|
| `401` | Unauthenticated. |
| `400` | Validation failure (length limits). |
| `404` | Not found or not owned. |
| `500` | Server error. |


---

#### Delete card

| | |
|---|---|
| **HTTP** | `DELETE` |
| **Path** | `/api/v1/cards/:cardId` |
| **Description** | Permanent delete (PRD US-006); confirmation is UI-only before calling this endpoint. |

**Response `204 No Content`**

Empty body.

**Error codes**

| Code | When |
|------|------|
| `401` | Unauthenticated. |
| `404` | Not found or not owned. |
| `500` | Server error. |

---

### 2.2 Generation sessions & proposals (`generation_sessions`, `card_proposals`)

#### Create generation session (run LLM)

| | |
|---|---|
| **HTTP** | `POST` |
| **Path** | `/api/v1/generation/sessions` |
| **Description** | Validates input length (PRD US-003), calls OpenRouter server-side, inserts one `generation_sessions` row and N `card_proposals` rows, returns session with proposals. `input_text` is not stored in DB (MVP). |

**Request body**

```json
{
  "input_text": "string"
}
```

**Validation**

- `input_text` length between **1000 and 10 000** characters (inclusive), per PRD US-003.
- After LLM response: enforce max **50** proposals per session in application logic (db-plan §1.3).

**Response `201 Created`**

```json
{
  "data": {
    "session": {
      "id": "uuid",
      "input_length": 3500,
      "generated_count": 12,
      "accepted_count": 0,
      "created_at": "ISO-8601"
    },
    "proposals": [
      {
        "id": "uuid",
        "session_id": "uuid",
        "front": "string",
        "back": "string",
        "position": 0,
        "created_at": "ISO-8601"
      }
    ]
  }
}
```

**Success codes**

- `201` — Session and proposals persisted.

**Error codes**

| Code | When |
|------|------|
| `401` | Unauthenticated. |
| `400` | Input length out of range, empty body, or invalid JSON. |
| `422` | LLM returned no usable proposals or parsing failed (user-facing message per PRD US-003). |
| `502` / `503` | Upstream OpenRouter failure or timeout. |
| `429` | Rate limit (see §4). |
| `500` | Unexpected server error. |

---

#### List generation sessions

| | |
|---|---|
| **HTTP** | `GET` |
| **Path** | `/api/v1/generation/sessions` |
| **Description** | Paginated list of the user’s sessions (history / stats context). Uses index `generation_sessions_user_id_idx`. |

**Query parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `page` | integer | `1` | Page index. |
| `limit` | integer | `20` | Page size (capped). |
| `sort` | string | `created_at_desc` | `created_at_desc` \| `created_at_asc` (sort by `created_at`). |

**Response `200 OK`**

```json
{
  "data": [
    {
      "id": "uuid",
      "input_length": 3500,
      "generated_count": 12,
      "accepted_count": 3,
      "created_at": "ISO-8601"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "has_more": false
  }
}
```

**Error codes:** `401`, `400`, `500` as for list endpoints.

---

#### Get generation session (with proposals)

| | |
|---|---|
| **HTTP** | `GET` |
| **Path** | `/api/v1/generation/sessions/:sessionId` |
| **Description** | Returns session metadata and all proposals for that session (`card_proposals_session_id_idx`). User must own the session via RLS chain. |

**Response `200 OK`**

```json
{
  "data": {
    "session": {
      "id": "uuid",
      "input_length": 3500,
      "generated_count": 12,
      "accepted_count": 3,
      "created_at": "ISO-8601"
    },
    "proposals": [
      {
        "id": "uuid",
        "session_id": "uuid",
        "front": "string",
        "back": "string",
        "position": 0,
        "created_at": "ISO-8601"
      }
    ]
  }
}
```

**Error codes**

| Code | When |
|------|------|
| `401` | Unauthenticated. |
| `400` | Invalid `sessionId` format (for example non-UUID). |
| `404` | Session not found or not accessible. |
| `500` | Server error. |

---

#### Accept proposals (bulk save to `cards`)

> **Handled by `POST /api/v1/cards`** — proposal acceptance (full or edited) is unified under the bulk card creation endpoint. Pass `proposal_id` per accepted item; the server derives `source = "ai_generated"`, updates `accepted_count`, and performs proposal cleanup in a single transaction. No separate session-scoped accept endpoint is needed.

---

#### Optional: reject or clear proposals

Not strictly required if UI only “ignores” rejects. If implemented:

| | |
|---|---|
| **HTTP** | `POST` |
| **Path** | `/api/v1/generation/sessions/:sessionId/proposals/delete` |
| **Description** | Body: `{ "proposal_ids": ["uuid"] }` — delete rows user explicitly rejected (cleanup). |

Alternatively, **omit** and rely on client-only rejection without DB delete until accept flow runs (db-plan allows orphan proposals in MVP).

---

### 2.3 Statistics (`generation_sessions` aggregates)

#### Generation statistics

| | |
|---|---|
| **HTTP** | `GET` |
| **Path** | `/api/v1/stats/generation` |
| **Description** | PRD §3.6 / FR6: totals for generated vs accepted across the user’s sessions (SUM of `generated_count`, SUM of `accepted_count`), optionally extra breakdown. |

**Response `200 OK`**

```json
{
  "data": {
    "total_generated": 240,
    "total_accepted": 180,
    "session_count": 42
  }
}
```

**Error codes:** `401`, `500`.

---


### 2.5 Health (optional, unauthenticated)

| | |
|---|---|
| **HTTP** | `GET` |
| **Path** | `/api/v1/health` |
| **Description** | Liveness for DigitalOcean / CI; no secrets. |

**Response `200 OK`:** `{ "status": "ok" }`

---

## 3. Authentication and Authorization

---

## 4. Validation and Business Logic

### 4.1 Per-resource validation

| Resource / action | Rules |
|-------------------|--------|
| **cards** `front` | Required on create/update; length ≤ **200** (PostgreSQL CHECK). |
| **cards** `back` | Required; length ≤ **500** (PostgreSQL CHECK). |
| **cards** `source` | Set only server-side in `POST /api/v1/cards`: `manual` when `proposal_id` is absent, `ai_generated` when `proposal_id` is present and valid. |
| **generation_sessions** `input_length` | Set server from measured `input_text` length on create. |
| **Generation input (PRD)** | `input_text` **1000–10 000** characters before calling LLM. |
| **card_proposals** count | ≤ **50** per session (application enforcement). |
| **card_proposals** `(session_id, position)` | Unique; server assigns `position` sequentially from LLM output order. |

### 4.2 Business logic placement

| Concern | Implementation |
|---------|----------------|
| LLM call | Only in `POST /api/v1/generation/sessions` (or shared server module); OpenRouter API key in server env only (tech-stack). |
| Accept flow | `POST /api/v1/cards` with `proposal_id`: transactional bulk insert into `cards` (server sets `source: ai_generated`), increment `accepted_count` on the owning session(s), delete accepted `card_proposals` rows. Works for proposals accepted as-is ("full") and after user edits ("edited"). |
| Manual CRUD | Standard REST on `/api/v1/cards` (same bulk create endpoint; for manual create client sends no `proposal_id`, server sets `source: manual`). |
| Stats | `GET /api/v1/stats/generation`: SQL aggregates over `generation_sessions` for `user_id = auth.uid()`. |
| Account deletion | `DELETE /api/v1/account`: Admin API + CASCADE (db-plan §5.2, §5.6). |
| Spaced repetition | **Out of scope** for REST in MVP; client library holds session state (PRD §4.1). |

### 4.3 Security and performance measures

| Measure | Detail |
|---------|--------|
| **Rate limiting** | Apply stricter limits on `POST /api/v1/generation/sessions` (costly LLM + OpenRouter budgets). Return `429` with `Retry-After` when exceeded. |
| **Payload size** | Reject bodies over a sane maximum (e.g. slightly above 10k chars for generation) to protect memory. |
| **Secrets** | `OPENROUTER_API_KEY` and Supabase **service role** only on server (DigitalOcean env / CI secrets). |
| **HTTPS** | Enforce TLS in production (hosting). |
| **Indexes** | List endpoints should use `cards_user_id_created_at_idx`, `generation_sessions_user_id_idx`, `card_proposals_session_id_idx` as per db-plan §3. |
| **CI/CD** | GitHub Actions runs tests/lint; no public API keys in logs (tech-stack). |

---

*This plan is intended to be implemented primarily as Astro server endpoints under `src/pages/api/v1/` with shared validation modules in `src/lib/`, typed against `src/db/database.types.ts`.*
