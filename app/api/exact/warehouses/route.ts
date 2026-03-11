import { NextRequest, NextResponse } from "next/server";
import { getWarehouses } from "@/lib/exact";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const division = request.nextUrl.searchParams.get("division");

  if (!division) {
    return NextResponse.json(
      { error: "division parameter is required" },
      { status: 400 }
    );
  }

  try {
    const warehouses = await getWarehouses(parseInt(division, 10));
    return NextResponse.json(warehouses);
  } catch (error) {
    console.error("Exact warehouses error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Exact warehouses" },
      { status: 500 }
    );
  }
}
