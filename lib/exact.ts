import { db } from "./db";
import { exactTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

const EXACT_BASE_URL = "https://start.exactonline.nl";
const EXACT_CLIENT_ID = process.env.EXACT_CLIENT_ID!;
const EXACT_CLIENT_SECRET = process.env.EXACT_CLIENT_SECRET!;
const EXACT_REDIRECT_URI = process.env.EXACT_REDIRECT_URI!;

// OAuth helpers
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

async function refreshAccessToken(division: number): Promise<string> {
  const [token] = await db
    .select()
    .from(exactTokens)
    .where(eq(exactTokens.division, division));

  if (!token?.refreshToken) {
    throw new Error(
      `No refresh token found for division ${division}. Please reconnect.`
    );
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
    throw new Error(`Exact token refresh failed for division ${division}: ${text}`);
  }

  const data = await res.json();

  // Store new tokens
  await db
    .update(exactTokens)
    .set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(exactTokens.division, division));

  return data.access_token;
}

async function getAccessToken(division: number): Promise<string> {
  const [token] = await db
    .select()
    .from(exactTokens)
    .where(eq(exactTokens.division, division));

  if (!token) {
    throw new Error(`No token found for division ${division}. Please connect first.`);
  }

  // If token is still valid (with 60s buffer), use it
  if (token.accessToken && token.expiresAt && token.expiresAt > new Date(Date.now() + 60000)) {
    return token.accessToken;
  }

  // Otherwise refresh
  return refreshAccessToken(division);
}

// Fetch all pages using __next pagination
async function exactFetchAll<T>(division: number, path: string): Promise<T[]> {
  const results: T[] = [];
  let url = `${EXACT_BASE_URL}/api/v1/${division}${path}`;

  while (url) {
    const accessToken = await getAccessToken(division);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Exact API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const items = data.d?.results || [];
    results.push(...items);

    url = data.d?.__next || "";
  }

  return results;
}

// Types
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

// API functions
export async function getItemWarehouses(
  division: number,
  warehouseCode: string
): Promise<ExactItemWarehouse[]> {
  return exactFetchAll<ExactItemWarehouse>(
    division,
    `/inventory/ItemWarehouses?$filter=WarehouseCode eq '${warehouseCode}'&$select=ItemCode,ItemDescription,WarehouseCode,WarehouseDescription,CurrentStock,PlannedStockIn,PlannedStockOut,ProjectedStock,ReservedStock`
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

export async function saveDivisionTokens(
  division: number,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  // Upsert: insert or update on conflict
  const existing = await db
    .select()
    .from(exactTokens)
    .where(eq(exactTokens.division, division));

  if (existing.length > 0) {
    await db
      .update(exactTokens)
      .set({
        accessToken,
        refreshToken,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(exactTokens.division, division));
  } else {
    await db.insert(exactTokens).values({
      division,
      accessToken,
      refreshToken,
      expiresAt,
    });
  }
}
