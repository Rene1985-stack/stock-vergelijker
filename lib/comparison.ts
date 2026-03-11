import {
  getWarehouseStock,
  getPurchaseOrders,
  aggregateIncoming,
} from "./picqer";
import { getItemWarehouses } from "./exact";
import { getDb } from "./db";
import { stockCache, warehouseMappings } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { WarehouseMapping } from "@/db/schema";

export interface ComparisonRow {
  sku: string;
  productName: string;
  picqerStock: number;
  picqerReserved: number;
  picqerIncoming: number;
  exactStock: number;
  exactPlannedIn: number;
  exactPlannedOut: number;
  stockDiff: number;
  incomingDiff: number;
  outgoingDiff: number;
  hasDifference: boolean;
}

export interface ComparisonResult {
  mapping: WarehouseMapping;
  rows: ComparisonRow[];
  totalSkus: number;
  skusWithDifference: number;
  fetchedAt: Date;
  fromCache: boolean;
  exactComplete: boolean;
  exactItemCount: number;
  exactPageCount: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function getComparison(
  mappingId: number
): Promise<ComparisonResult> {
  // Get mapping
  const [mapping] = await getDb()
    .select()
    .from(warehouseMappings)
    .where(eq(warehouseMappings.id, mappingId));

  if (!mapping) {
    throw new Error(`Mapping ${mappingId} not found`);
  }

  // Check cache
  const cached = await getDb()
    .select()
    .from(stockCache)
    .where(eq(stockCache.mappingId, mappingId));

  if (cached.length > 0 && cached[0].fetchedAt) {
    const age = Date.now() - cached[0].fetchedAt.getTime();
    if (age < CACHE_TTL_MS) {
      const rows = cached.map(cacheToRow);
      return {
        mapping,
        rows,
        totalSkus: rows.length,
        skusWithDifference: rows.filter((r) => r.hasDifference).length,
        fetchedAt: cached[0].fetchedAt,
        fromCache: true,
        exactComplete: true, // Cached data was already validated as complete
        exactItemCount: 0,
        exactPageCount: 0,
      };
    }
  }

  // Fetch fresh data from both APIs
  const [picqerStock, picqerPOs, exactResult] = await Promise.all([
    getWarehouseStock(mapping.picqerWarehouseId),
    getPurchaseOrders(mapping.picqerWarehouseId),
    getItemWarehouses(mapping.exactDivision, mapping.exactWarehouseCode),
  ]);

  const exactData = exactResult.data;
  const exactComplete = exactResult.complete;

  // Aggregate Picqer incoming from purchase orders
  const incomingMap = aggregateIncoming(picqerPOs);

  // Build Exact lookup by ItemCode
  const exactMap = new Map(exactData.map((item) => [item.ItemCode, item]));

  // Collect all unique SKUs
  const allSkuSet = new Set<string>();
  for (const entry of picqerStock) {
    allSkuSet.add(entry.productcode);
  }
  for (const item of exactData) {
    allSkuSet.add(item.ItemCode);
  }
  const allSkus = Array.from(allSkuSet);

  // Build Picqer lookup by productcode
  const picqerMap = new Map(picqerStock.map((e) => [e.productcode, e]));

  // Build comparison rows
  const rows: ComparisonRow[] = [];
  for (const sku of allSkus) {
    const picqer = picqerMap.get(sku);
    const exact = exactMap.get(sku);

    const pStock = picqer?.stock?.stock ?? 0;
    const pReserved = picqer?.stock?.reserved ?? 0;
    const pIncoming = incomingMap.get(sku) ?? 0;
    const eStock = exact?.CurrentStock ?? 0;
    const ePlannedIn = exact?.PlannedStockIn ?? 0;
    const ePlannedOut = exact?.PlannedStockOut ?? 0;

    const stockDiff = pStock - eStock;
    const incomingDiff = pIncoming - ePlannedIn;
    const outgoingDiff = pReserved - ePlannedOut;

    rows.push({
      sku,
      productName: exact?.ItemDescription || "",
      picqerStock: pStock,
      picqerReserved: pReserved,
      picqerIncoming: pIncoming,
      exactStock: eStock,
      exactPlannedIn: ePlannedIn,
      exactPlannedOut: ePlannedOut,
      stockDiff,
      incomingDiff,
      outgoingDiff,
      // Only stock and incoming diffs count — Exact has no planned outgoing
      hasDifference: stockDiff !== 0 || incomingDiff !== 0,
    });
  }

  // Sort: differences first (by largest absolute stock diff), then by SKU
  rows.sort((a, b) => {
    if (a.hasDifference !== b.hasDifference) return a.hasDifference ? -1 : 1;
    if (a.hasDifference && b.hasDifference) {
      return Math.abs(b.stockDiff) - Math.abs(a.stockDiff);
    }
    return a.sku.localeCompare(b.sku);
  });

  const fetchedAt = new Date();

  // Only cache COMPLETE results — partial data would give wrong comparisons
  if (exactComplete) {
    try {
      await getDb().delete(stockCache).where(eq(stockCache.mappingId, mappingId));

      if (rows.length > 0) {
        // Insert in very small batches - Neon HTTP driver has strict param limits
        // 10 columns per row × 5 rows = 50 params per query (safe for Neon)
        const batchSize = 5;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          await getDb().insert(stockCache).values(
            batch.map((row) => ({
              mappingId,
              sku: row.sku,
              productName: row.productName || null,
              picqerStock: row.picqerStock,
              picqerReserved: row.picqerReserved,
              picqerIncoming: row.picqerIncoming,
              exactStock: String(row.exactStock),
              exactPlannedIn: String(row.exactPlannedIn),
              exactPlannedOut: String(row.exactPlannedOut),
              fetchedAt,
            }))
          );
        }
      }
    } catch (cacheErr) {
      console.error("[Cache] Failed to save comparison cache:", cacheErr);
    }
  } else {
    console.log(
      `[Comparison] Skipping cache for mapping ${mappingId} — ` +
      `Exact data incomplete (${exactData.length} items from ${exactResult.pageCount} pages)`
    );
  }

  return {
    mapping,
    rows,
    totalSkus: rows.length,
    skusWithDifference: rows.filter((r) => r.hasDifference).length,
    fetchedAt,
    fromCache: false,
    exactComplete,
    exactItemCount: exactData.length,
    exactPageCount: exactResult.pageCount,
  };
}

function cacheToRow(entry: typeof stockCache.$inferSelect): ComparisonRow {
  const pStock = entry.picqerStock ?? 0;
  const pReserved = entry.picqerReserved ?? 0;
  const pIncoming = entry.picqerIncoming ?? 0;
  const eStock = Number(entry.exactStock ?? 0);
  const ePlannedIn = Number(entry.exactPlannedIn ?? 0);
  const ePlannedOut = Number(entry.exactPlannedOut ?? 0);

  const stockDiff = pStock - eStock;
  const incomingDiff = pIncoming - ePlannedIn;
  const outgoingDiff = pReserved - ePlannedOut;

  return {
    sku: entry.sku,
    productName: entry.productName || "",
    picqerStock: pStock,
    picqerReserved: pReserved,
    picqerIncoming: pIncoming,
    exactStock: eStock,
    exactPlannedIn: ePlannedIn,
    exactPlannedOut: ePlannedOut,
    stockDiff,
    incomingDiff,
    outgoingDiff,
    // Only stock and incoming diffs count — Exact has no planned outgoing
    hasDifference: stockDiff !== 0 || incomingDiff !== 0,
  };
}
