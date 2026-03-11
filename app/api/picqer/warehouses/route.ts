import { NextResponse } from "next/server";
import { getWarehouses } from "@/lib/picqer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const warehouses = await getWarehouses();
    return NextResponse.json(warehouses);
  } catch (error) {
    console.error("Picqer warehouses error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Picqer warehouses" },
      { status: 500 }
    );
  }
}
