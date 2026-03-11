import {
  getWarehouseStock,
  getPurchaseOrders,
  aggregateIncoming,
} from "./picqer";
import { getDb } from "./db";
import { warehouseMappings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
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

  // Read Exact data from exact_stock table (pre-synced via /api/sync-exact)
  const sql = neon(process.env.DATABASE_URL!);

  // Verify sync is complete
  const syncStates = await sql(
    "SELECT * FROM sync_state WHERE mapping_id = $1",
    [mappingId]
  );
  const syncState = syncStates[0];
  if (!syncState || syncState.next_url) {
    throw new Error(
      "Exact Online data nog niet gesynchroniseerd. Start synchronisatie eerst."
    );
  }

  // Read synced Exact stock data
  const exactRows = await sql(
    "SELECT * FROM exact_stock WHERE mapping_id = $1",
    [mappingId]
  );

  const exactData = exactRows.map((r) => ({
    ItemCode: r.item_code as string,
    ItemDescription: (r.item_description as string) || "",
    CurrentStock: Number(r.current_stock) || 0,
    PlannedStockIn: Number(r.planned_stock_in) || 0,
    PlannedStockOut: Number(r.planned_stock_out) || 0,
    ReservedStock: Number(r.reserved_stock) || 0,
  }));

  // Fetch fresh Picqer data (fast: 500 req/min, 100 items/page)
  const [picqerStock, picqerPOs] = await Promise.all([
    getWarehouseStock(mapping.picqerWarehouseId),
    getPurchaseOrders(mapping.picqerWarehouseId),
  ]);

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

  return {
    mapping,
    rows,
    totalSkus: rows.length,
    skusWithDifference: rows.filter((r) => r.hasDifference).length,
    fetchedAt: new Date(),
    fromCache: false,
    exactComplete: true,
    exactItemCount: exactData.length,
    exactPageCount: 0,
  };
}
