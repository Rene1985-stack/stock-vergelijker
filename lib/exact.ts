import { getDb } from "./db";
import { exactTokens } from "@/db/schema";

const EXACT_BASE_URL = "https://start.exactonline.nl";
const EXACT_CLIENT_ID = process.env.EXACT_CLIENT_ID!;
const EXACT_CLIENT_SECRET = process.env.EXACT_CLIENT_SECRET!;
const EXACT_REDIRECT_URI = process.env.EXACT_REDIRECT_URI!;

// ──────────────────────────────────────────────
// Exact Online API rate limits (per app-company):
//   - 60 requests per minute
//   - 5,000 requests per day
//
// Response headers on 429:
//   X-RateLimit-Minutely-Remaining: 0
//   X-RateLimit-Minutely-Reset: <unix-timestamp>
//   X-RateLimit-Remaining: <daily-remaining>
//   X-RateLimit-Reset: <unix-timestamp>
//
// When minutely limit is hit, ONLY minutely headers are sent.
// ──────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── OAuth helpers ───────────────────────────────

export function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: EXACT_CLIENT_ID,
    redirect_uri: EXACT_REDIRECT_URI,
    response_type: "code",
    force_login: "0",
  });
  if (state) params.set("state", state);
  return `${EXACT_BASE_URL}/api/oauth2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch(`${EXACT_BASE_URL}/api/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: EXACT_REDIRECT_URI,
      client_id: EXACT_CLIENT_ID,
      client_secret: EXACT_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Exact OAuth token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

// ── Token management (single token for all divisions) ───

async function getStoredToken() {
  const rows = await getDb().select().from(exactTokens);
  return rows[0] ?? null;
}

async function refreshAccessToken(): Promise<string> {
  const token = await getStoredToken();

  if (!token?.refreshToken) {
    throw new Error("No refresh token found. Please reconnect to Exact Online.");
  }

  const res = await fetch(`${EXACT_BASE_URL}/api/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: EXACT_CLIENT_ID,
      client_secret: EXACT_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Exact token refresh failed: ${text}`);
  }

  const data = await res.json();

  // Use raw SQL to avoid Drizzle DEFAULT keyword issues with Neon HTTP driver
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);

  await sql(
    "UPDATE exact_tokens SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW() WHERE id = $4",
    [data.access_token, data.refresh_token, newExpiresAt.toISOString(), token.id]
  );

  return data.access_token;
}

export async function getAccessToken(): Promise<string> {
  const token = await getStoredToken();

  if (!token) {
    throw new Error("Not connected to Exact Online. Please connect first.");
  }

  // Check if token is still valid.
  // Use 5-minute buffer to account for timezone issues with
  // timestamp without time zone columns (Drizzle may add local TZ offset)
  if (token.accessToken && token.expiresAt && token.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return token.accessToken;
  }

  return refreshAccessToken();
}

// Force refresh the token (called on 401 from API)
async function forceRefreshToken(): Promise<string> {
  console.log("[Exact API] Forcing token refresh due to 401");
  return refreshAccessToken();
}

// ── Rate-limited fetch with proper Exact Online header handling ───

/**
 * Calculates how long to wait based on Exact Online rate limit headers.
 * Returns 0 if no waiting needed.
 */
function getWaitTimeFromHeaders(headers: Headers): number {
  // Check minutely limit first (takes priority per Exact docs)
  const minutelyRemaining = headers.get("X-RateLimit-Minutely-Remaining");
  const minutelyReset = headers.get("X-RateLimit-Minutely-Reset");

  if (minutelyRemaining !== null && parseInt(minutelyRemaining, 10) <= 0 && minutelyReset) {
    const resetMs = parseInt(minutelyReset, 10) * 1000;
    const waitMs = Math.max(resetMs - Date.now(), 0) + 500; // 500ms buffer
    return Math.min(waitMs, 65000); // cap at 65s
  }

  // Check daily limit
  const dailyRemaining = headers.get("X-RateLimit-Remaining");
  if (dailyRemaining !== null && parseInt(dailyRemaining, 10) <= 0) {
    throw new Error(
      "Exact Online daily API limit (5,000 calls) reached. Try again tomorrow."
    );
  }

  return 0;
}

/**
 * Proactively throttle if we're running low on minutely requests.
 * Only throttle at the very end to maximize throughput within Vercel's
 * 60-second function timeout. The 429 retry mechanism handles actual limits.
 */
function getProactiveDelay(headers: Headers): number {
  const remaining = headers.get("X-RateLimit-Minutely-Remaining");
  if (remaining === null) return 0;

  const left = parseInt(remaining, 10);
  if (left <= 2) return 2000;   // Almost exhausted: slow down to avoid 429
  return 0; // No delay — maximize throughput, let 429 handler manage limits
}

/**
 * Fetch with Exact Online rate limit & auth awareness:
 * 1. On 401: refreshes access token and retries once
 * 2. On 429: reads reset headers and waits precisely until reset
 * 3. On success: reads remaining headers and proactively throttles
 */
async function exactFetch(
  url: string,
  getOptions: () => Promise<RequestInit>,
  maxRetries = 3
): Promise<Response> {
  let hasRefreshedToken = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const options = await getOptions();
    const res = await fetch(url, options);

    // Handle 401: refresh token once and retry
    if (res.status === 401 && !hasRefreshedToken) {
      hasRefreshedToken = true;
      try {
        await forceRefreshToken();
      } catch {
        throw new Error(
          "Exact Online sessie verlopen. Ga naar Instellingen en verbind opnieuw."
        );
      }
      continue; // Retry with new token (getOptions will fetch fresh token)
    }

    // If still 401 after refresh, the session is truly invalid
    if (res.status === 401) {
      throw new Error(
        "Exact Online sessie verlopen. Ga naar Instellingen en verbind opnieuw."
      );
    }

    if (res.status === 429) {
      if (attempt >= maxRetries) {
        throw new Error(
          "Exact Online rate limit: too many requests. Please try again in a minute."
        );
      }

      // Read Exact headers to determine exact wait time
      const minutelyReset = res.headers.get("X-RateLimit-Minutely-Reset");
      let waitMs: number;

      if (minutelyReset) {
        // Wait until the reset timestamp + small buffer
        waitMs = Math.max(parseInt(minutelyReset, 10) * 1000 - Date.now(), 0) + 1000;
        waitMs = Math.min(waitMs, 65000); // Cap at 65 seconds
      } else {
        // Fallback: exponential backoff
        waitMs = Math.min(2000 * Math.pow(2, attempt), 30000);
      }

      console.log(
        `[Exact API] Rate limited (429). Waiting ${Math.round(waitMs / 1000)}s ` +
        `before retry ${attempt + 1}/${maxRetries}`
      );
      await sleep(waitMs);
      continue;
    }

    return res;
  }

  throw new Error("Max retries exceeded for Exact API");
}

// ── Paginated data fetching ─────────────────────

/**
 * Fetch all pages using Exact's __next pagination.
 * Respects rate limits and Vercel's function timeout:
 * - Reads X-RateLimit headers after each request
 * - On 429: waits precisely until reset
 * - Time budget: stops before Vercel timeout (default 50s)
 */
export interface FetchResult<T> {
  data: T[];
  complete: boolean;
  pageCount: number;
}

async function exactFetchAll<T>(
  division: number,
  path: string,
  timeBudgetMs = 50000 // Stop 10s before Vercel's 60s limit
): Promise<FetchResult<T>> {
  const startTime = Date.now();
  const results: T[] = [];
  let url: string = `${EXACT_BASE_URL}/api/v1/${division}${path}`;
  let pageCount = 0;
  let complete = true;

  while (url) {
    // Check time budget before starting a new page fetch
    const elapsed = Date.now() - startTime;
    if (elapsed > timeBudgetMs) {
      console.log(
        `[Exact API] Time budget exhausted after ${pageCount} pages ` +
        `(${Math.round(elapsed / 1000)}s). Returning ${results.length} items (INCOMPLETE).`
      );
      complete = false;
      break;
    }

    const res = await exactFetch(
      url,
      async () => {
        const accessToken = await getAccessToken();
        return {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        };
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Exact API error: ${res.status} ${res.statusText} ${text}`);
    }

    pageCount++;

    // Check if we need to wait (minutely limit exhausted)
    const waitTime = getWaitTimeFromHeaders(res.headers);
    if (waitTime > 0) {
      // If waiting would exceed our time budget, return what we have
      if (Date.now() + waitTime - startTime > timeBudgetMs) {
        console.log(
          `[Exact API] Rate limit wait (${Math.round(waitTime / 1000)}s) would exceed ` +
          `time budget. Returning ${results.length} items from ${pageCount} pages (INCOMPLETE).`
        );
        const data = await res.json();
        const items = data.d?.results || [];
        results.push(...items);
        complete = false;
        break;
      }
      console.log(
        `[Exact API] Minutely limit reached after ${pageCount} pages. ` +
        `Waiting ${Math.round(waitTime / 1000)}s...`
      );
      await sleep(waitTime);
    }

    const data = await res.json();
    const items = data.d?.results || [];
    results.push(...items);

    url = data.d?.__next || "";

    // Minimal proactive throttling (only when nearly exhausted)
    if (url) {
      const delay = getProactiveDelay(res.headers);
      if (delay > 0) {
        console.log(
          `[Exact API] Proactive throttle: ${delay}ms ` +
          `(remaining: ${res.headers.get("X-RateLimit-Minutely-Remaining")})`
        );
        await sleep(delay);
      }
    }
  }

  console.log(
    `[Exact API] Fetched ${results.length} items in ${pageCount} pages for division ${division}` +
    (complete ? " (complete)" : " (INCOMPLETE)")
  );
  return { data: results, complete, pageCount };
}

// ── Types ────────────────────────────────────────

export interface ExactItemWarehouse {
  ItemCode: string;
  ItemDescription: string;
  WarehouseCode: string;
  WarehouseDescription: string;
  CurrentStock: number;
  PlannedStockIn: number;
  PlannedStockOut: number;
  ProjectedStock: number;
  ReservedStock: number;
}

export interface ExactWarehouse {
  Code: string;
  Description: string;
  ID: string;
}

// ── API functions ────────────────────────────────

export async function getItemWarehouses(
  division: number,
  warehouseCode: string
): Promise<FetchResult<ExactItemWarehouse>> {
  // Filter to items with non-zero stock/planned to dramatically reduce pages.
  // Items with 0 across the board are irrelevant for comparison (Picqer side
  // still captures items that exist only there).
  const filter = [
    `WarehouseCode eq '${warehouseCode}'`,
    `(CurrentStock ne 0 or PlannedStockIn ne 0 or PlannedStockOut ne 0 or ReservedStock ne 0)`,
  ].join(" and ");

  return exactFetchAll<ExactItemWarehouse>(
    division,
    `/inventory/ItemWarehouses?$filter=${encodeURIComponent(filter)}&$select=ItemCode,ItemDescription,WarehouseCode,WarehouseDescription,CurrentStock,PlannedStockIn,PlannedStockOut,ProjectedStock,ReservedStock`
  );
}

export async function getWarehouses(division: number): Promise<ExactWarehouse[]> {
  return exactFetchAll<ExactWarehouse>(
    division,
    `/logistics/Warehouses?$select=Code,Description,ID`
  );
}

export async function getCurrentDivision(accessToken: string): Promise<number> {
  const res = await fetch(
    `${EXACT_BASE_URL}/api/v1/current/Me?$select=CurrentDivision`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) throw new Error("Failed to get current division");

  const data = await res.json();
  return data.d.results[0].CurrentDivision;
}

// ── Token persistence ────────────────────────────

export async function saveTokens(
  division: number,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  // Use raw SQL to avoid Drizzle's DEFAULT keyword issues with Neon HTTP driver.
  // Single atomic UPSERT: if a row with this division exists, update it;
  // otherwise insert. Also delete any other rows first (we only keep one token).
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);

  // Delete any tokens for OTHER divisions (we keep a single token)
  await sql("DELETE FROM exact_tokens WHERE division != $1", [division]);

  // Upsert the token for this division
  await sql(
    `INSERT INTO exact_tokens (division, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (division) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()`,
    [division, accessToken, refreshToken, expiresAt.toISOString()]
  );
}
