import { NextResponse } from "next/server";
import { getWarehouses } from "@/lib/picqer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const baseUrl = process.env.PICQER_BASE_URL;
    const hasKey = !!process.env.PICQER_API_KEY;

    if (!baseUrl || !hasKey) {
      return NextResponse.json(
        { error: `Missing env vars: PICQER_BASE_URL=${baseUrl ? "set" : "missing"}, PICQER_API_KEY=${hasKey ? "set" : "missing"}` },
        { status: 500 }
      );
    }

    const warehouses = await getWarehouses();
    return NextResponse.json(warehouses);
  } catch (error) {
    console.error("Picqer warehouses error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch Picqer warehouses: ${message}` },
      { status: 500 }
    );
  }
}
