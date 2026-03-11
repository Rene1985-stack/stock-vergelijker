import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exactTokens } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tokens = await db.select({
      division: exactTokens.division,
      expiresAt: exactTokens.expiresAt,
      updatedAt: exactTokens.updatedAt,
    }).from(exactTokens);

    return NextResponse.json(tokens);
  } catch (error) {
    console.error("Token list error:", error);
    return NextResponse.json({ error: "Failed to fetch tokens" }, { status: 500 });
  }
}
