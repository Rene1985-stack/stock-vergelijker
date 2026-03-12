const PICQER_BASE_URL = (process.env.PICQER_BASE_URL || "").replace(/\/+$/, "");
const PICQER_API_KEY = process.env.PICQER_API_KEY!;

function getAuthHeader(): string {
  return "Basic " + Buffer.from(PICQER_API_KEY + ":x").toString("base64");
}

async function picqerFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${PICQER_BASE_URL}/api/v1${path}`, {
    headers: {
      Authorization: getAuthHeader(),
      "User-Agent": "StockVergelijker (stock-vergelijker@app.com)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Picqer API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function picqerFetchAll<T>(path: string): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await picqerFetch<T[]>(`${path}${separator}offset=${offset}`);
    results.push(...page);

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return results;
}

// Types
export interface PicqerWarehouse {
  idwarehouse: number;
  name: string;
  accept_orders: boolean;
  counts_for_general_stock: boolean;
  active: boolean;
}

export interface PicqerStockEntry {
  idproduct: number;
  productcode: string;
  stock: {
    idwarehouse: number;
    stock: number;
    reserved: number;
    reservedbackorders: number;
    reservedpicklists: number;
    reservedallocations: number;
    freestock: number;
  };
}

export interface PicqerPurchaseOrder {
  idpurchaseorder: number;
  idwarehouse: number;
  status: string;
  products: Array<{
    idproduct: number;
    idpurchaseorder_product: number;
    productcode: string;
    amount: number;
    amountreceived: number;
  }>;
}

// API functions
export async function getWarehouses(): Promise<PicqerWarehouse[]> {
  return picqerFetch<PicqerWarehouse[]>("/warehouses");
}

export async function getWarehouseStock(
  warehouseId: number
): Promise<PicqerStockEntry[]> {
  return picqerFetchAll<PicqerStockEntry>(
    `/warehouses/${warehouseId}/stock`
  );
}

export async function getPurchaseOrders(
  warehouseId: number
): Promise<PicqerPurchaseOrder[]> {
  return picqerFetchAll<PicqerPurchaseOrder>(
    `/purchaseorders?idwarehouse=${warehouseId}&status=purchased`
  );
}

// ── Product types ────────────────────────────────

export interface PicqerProductType {
  idproducttype: number;
  name: string;
}

export interface PicqerProduct {
  idproduct: number;
  productcode: string;
  name: string;
  type: string; // "normal" | "virtual" | "set"
  idproducttype: number | null;
}

export async function getProductTypes(): Promise<PicqerProductType[]> {
  return picqerFetchAll<PicqerProductType>("/producttypes");
}

/**
 * Fetch all products and build a map of productcode → product type name.
 * Fetches product types list first, then all products, and joins them.
 */
export async function getProductTypeMap(): Promise<Map<string, string>> {
  const [productTypes, products] = await Promise.all([
    getProductTypes(),
    picqerFetchAll<PicqerProduct>("/products"),
  ]);

  // Build type ID → name lookup
  const typeNames = new Map<number, string>();
  for (const pt of productTypes) {
    typeNames.set(pt.idproducttype, pt.name);
  }

  // Build productcode → type name
  const result = new Map<string, string>();
  for (const p of products) {
    const typeName = p.idproducttype ? typeNames.get(p.idproducttype) ?? "" : "";
    result.set(p.productcode, typeName);
  }

  return result;
}

// Aggregate incoming stock per productcode from purchase orders
export function aggregateIncoming(
  purchaseOrders: PicqerPurchaseOrder[]
): Map<string, number> {
  const incoming = new Map<string, number>();

  for (const po of purchaseOrders) {
    for (const product of po.products) {
      const toReceive = product.amount - product.amountreceived;
      if (toReceive > 0) {
        incoming.set(
          product.productcode,
          (incoming.get(product.productcode) || 0) + toReceive
        );
      }
    }
  }

  return incoming;
}
