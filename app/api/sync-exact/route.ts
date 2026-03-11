import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getAccessToken, forceRefreshToken } from "@/lib/exact";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const TIME_BUDGET_MS = 45_000; // 45s for fetching, leaves buffer for DB writes
const SYNC_TTL_MS = 15 * 60 * 1000; // 15 minutes
const EXACT_BASE_URL = "https://start.exactonline.nl";

// ── Batch upsert items into exact_stock ──────────

async function batchUpsert(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
  mappingId: number,
  items: Array<{
    ItemCode: string;
    ItemDescription?: string;
    CurrentStock?: number;
    PlannedStockIn?: number;
    PlannedStockOut?: number;
    ReservedStock?: number;
  }>
) {
  const batchSize = 10; // 7 columns × 10 rows = 70 params (within Neon's limits)
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const placeholders = batch
      .map((_, idx) => {
        const o = idx * 7 + 1;
        return `($${o}, $${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`;
      })
      .join(", ");

    const params = batch.flatMap((item) => [
      mappingId,
      item.ItemCode,
      item.ItemDescription || "",
      item.CurrentStock || 0,
      item.PlannedStockIn || 0,
      item.PlannedStockOut || 0,
      item.ReservedStock || 0,
    ]);

    await sql(
      `INSERT INTO exact_stock (mapping_id, item_code, item_description, current_stock, planned_stock_in, planned_stock_out, reserved_stock)
       VALUES ${placeholders}
       ON CONFLICT (mapping_id, item_code) DO UPDATE SET
         item_description = EXCLUDED.item_description,
         current_stock = EXCLUDED.current_stock,
         planned_stock_in = EXCLUDED.planned_stock_in,
         planned_stock_out = EXCLUDED.planned_stock_out,
         reserved_stock = EXCLUDED.reserved_stock`,
      params
    );
  }
}

// ── GET: Check sync status ───────────────────────

export async function GET(request: NextRequest) {
  const mappingId = request.nextUrl.searchParams.get("mappingId");
  if (!mappingId) {
    return NextResponse.json({ error: "mappingId required" }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const states = await sql(
    "SELECT * FROM sync_state WHERE mapping_id = $1",
    [parseInt(mappingId, 10)]
  );

  if (states.length === 0) {
    return NextResponse.json({ status: "none", itemsFetched: 0 });
  }

  const state = states[0];
  const hasNextUrl = !!state.next_url;
  const isFresh =
    state.updated_at &&
    Date.now() - new Date(state.updated_at).getTime() < SYNC_TTL_MS;

  if (!hasNextUrl && isFresh) {
    return NextResponse.json({
      status: "complete",
      itemsFetched: state.items_fetched,
      startedAt: state.started_at,
      updatedAt: state.updated_at,
    });
  }

  if (hasNextUrl) {
    return NextResponse.json({
      status: "syncing",
      itemsFetched: state.items_fetched,
      startedAt: state.started_at,
    });
  }

  return NextResponse.json({
    status: "stale",
    itemsFetched: state.items_fetched,
    updatedAt: state.updated_at,
  });
}

// ── POST: Start or continue sync ─────────────────

export async function POST(request: NextRequest) {
  const body = await request.json();
  const mappingId: number = body.mappingId;
  const reset: boolean = body.reset ?? false;

  if (!mappingId) {
    return NextResponse.json({ error: "mappingId required" }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Get mapping info
  const mappings = await sql(
    "SELECT * FROM warehouse_mappings WHERE id = $1",
    [mappingId]
  );
  if (mappings.length === 0) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }
  const mapping = mappings[0];

  // Check current sync state
  const states = await sql(
    "SELECT * FROM sync_state WHERE mapping_id = $1",
    [mappingId]
  );
  let state = states[0];

  const isComplete = state && !state.next_url;
  const isFresh =
    state?.updated_at &&
    Date.now() - new Date(state.updated_at).getTime() < SYNC_TTL_MS;

  // If complete and fresh and no reset: nothing to do
  if (isComplete && isFresh && !reset) {
    return NextResponse.json({
      status: "complete",
      itemsFetched: state.items_fetched,
    });
  }

  // If reset or stale or first time: start fresh
  if (reset || !state || (isComplete && !isFresh)) {
    console.log(
      `[Sync] Starting fresh sync for mapping ${mappingId} ` +
        `(div ${mapping.exact_division}, wh ${mapping.exact_warehouse_code})`
    );
    await sql("DELETE FROM exact_stock WHERE mapping_id = $1", [mappingId]);

    const filter = [
      `WarehouseCode eq '${mapping.exact_warehouse_code}'`,
      `(CurrentStock ne 0 or PlannedStockIn ne 0 or PlannedStockOut ne 0 or ReservedStock ne 0)`,
    ].join(" and ");

    const initialUrl =
      `${EXACT_BASE_URL}/api/v1/${mapping.exact_division}/inventory/ItemWarehouses` +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$select=ItemCode,ItemDescription,WarehouseCode,WarehouseDescription,CurrentStock,PlannedStockIn,PlannedStockOut,ProjectedStock,ReservedStock`;

    await sql(
      `INSERT INTO sync_state (mapping_id, next_url, items_fetched, started_at, updated_at)
       VALUES ($1, $2, 0, NOW(), NOW())
       ON CONFLICT (mapping_id) DO UPDATE SET
         next_url = $2, items_fetched = 0, started_at = NOW(), updated_at = NOW()`,
      [mappingId, initialUrl]
    );

    state = {
      mapping_id: mappingId,
      next_url: initialUrl,
      items_fetched: 0,
    };
  }

  // If sync already in progress (next_url exists), continue from there
  const startTime = Date.now();
  let url: string = state.next_url;
  let itemsFetched: number = state.items_fetched || 0;
  let pagesThisCall = 0;
  let hasRefreshedToken = false;

  while (url) {
    // Check time budget
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.log(
        `[Sync] Time budget reached after ${pagesThisCall} pages. ` +
          `Total items: ${itemsFetched}`
      );
      break;
    }

    // Get access token (auto-refreshes if near expiry)
    let accessToken: string;
    try {
      accessToken = await getAccessToken();
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "Token error",
        },
        { status: 401 }
      );
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    // Handle 401: refresh token once and retry
    if (res.status === 401 && !hasRefreshedToken) {
      hasRefreshedToken = true;
      try {
        await forceRefreshToken();
        continue; // Retry same URL with new token
      } catch {
        return NextResponse.json(
          {
            error:
              "Exact Online sessie verlopen. Ga naar Instellingen en verbind opnieuw.",
          },
          { status: 401 }
        );
      }
    }

    if (res.status === 401) {
      return NextResponse.json(
        {
          error:
            "Exact Online sessie verlopen. Ga naar Instellingen en verbind opnieuw.",
        },
        { status: 401 }
      );
    }

    // Handle 429: save state and return with retry info
    if (res.status === 429) {
      const minutelyReset = res.headers.get("X-RateLimit-Minutely-Reset");
      let retryAfterMs = 60_000;
      if (minutelyReset) {
        retryAfterMs =
          Math.max(parseInt(minutelyReset, 10) * 1000 - Date.now(), 0) + 1000;
      }

      // If we can wait within the time budget, wait and continue
      if (Date.now() + retryAfterMs - startTime < TIME_BUDGET_MS) {
        console.log(
          `[Sync] Rate limited, waiting ${Math.round(retryAfterMs / 1000)}s within budget`
        );
        await new Promise((r) => setTimeout(r, retryAfterMs));
        continue;
      }

      // Save state for next call
      await sql(
        "UPDATE sync_state SET next_url = $1, items_fetched = $2, updated_at = NOW() WHERE mapping_id = $3",
        [url, itemsFetched, mappingId]
      );

      return NextResponse.json({
        status: "rate_limited",
        itemsFetched,
        pagesThisCall,
        retryAfterMs: Math.min(retryAfterMs, 65_000),
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Exact API error: ${res.status} ${text}` },
        { status: 500 }
      );
    }

    pagesThisCall++;
    const data = await res.json();
    const items = data.d?.results || [];

    // Insert items into exact_stock
    if (items.length > 0) {
      await batchUpsert(sql, mappingId, items);
      itemsFetched += items.length;
    }

    // Move to next page
    url = data.d?.__next || "";

    // Check rate limit headers for proactive throttling
    const remaining = res.headers.get("X-RateLimit-Minutely-Remaining");
    if (remaining !== null && parseInt(remaining, 10) <= 2) {
      const minutelyReset = res.headers.get("X-RateLimit-Minutely-Reset");
      if (minutelyReset) {
        const waitMs =
          Math.max(parseInt(minutelyReset, 10) * 1000 - Date.now(), 0) + 500;
        if (Date.now() + waitMs - startTime < TIME_BUDGET_MS) {
          console.log(
            `[Sync] Proactive throttle: waiting ${Math.round(waitMs / 1000)}s`
          );
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          // Can't wait within budget, save and return
          break;
        }
      }
    }
  }

  // Update sync state
  const complete = !url;
  await sql(
    "UPDATE sync_state SET next_url = $1, items_fetched = $2, updated_at = NOW() WHERE mapping_id = $3",
    [url || null, itemsFetched, mappingId]
  );

  console.log(
    `[Sync] ${complete ? "Complete" : "Partial"}: ${itemsFetched} items, ` +
      `${pagesThisCall} pages this call for mapping ${mappingId}`
  );

  return NextResponse.json({
    status: complete ? "complete" : "syncing",
    itemsFetched,
    pagesThisCall,
  });
}
