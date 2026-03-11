import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { exactTokens } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const db = drizzle(sql);

    const rows = await db.select({
      division: exactTokens.division,
      expiresAt: exactTokens.expiresAt,
      updatedAt: exactTokens.updatedAt,
    }).from(exactTokens);

    const token = rows[0] ?? null;

    return NextResponse.json({
      connected: !!token,
      division: token?.division ?? null,
      updatedAt: token?.updatedAt ?? null,
    });
  } catch (error) {
    console.error("Token status error:", error);
    return NextResponse.json({ error: "Failed to check connection" }, { status: 500 });
  }
}
