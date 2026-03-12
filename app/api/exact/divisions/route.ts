import { NextResponse } from "next/server";
import { getDivisions } from "@/lib/exact";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const divisions = await getDivisions();
    return NextResponse.json(divisions);
  } catch (error) {
    console.error("Exact divisions error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Exact divisions" },
      { status: 500 }
    );
  }
}
