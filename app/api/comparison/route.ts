import { NextRequest, NextResponse } from "next/server";
import { getComparison } from "@/lib/comparison";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60s max (Hobby plan limit)

export async function GET(request: NextRequest) {
  const mappingId = request.nextUrl.searchParams.get("mapping_id");

  if (!mappingId) {
    return NextResponse.json(
      { error: "mapping_id parameter is required" },
      { status: 400 }
    );
  }

  try {
    const result = await getComparison(parseInt(mappingId, 10));
    return NextResponse.json(result);
  } catch (error) {
    console.error("Comparison error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
