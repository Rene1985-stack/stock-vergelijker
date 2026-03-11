import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);

    const tables = await sql(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );

    return NextResponse.json({
      dbUrlPrefix: process.env.DATABASE_URL?.substring(0, 30) + "...",
      tables: tables.map((t: Record<string, string>) => t.table_name),
    });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown",
    }, { status: 500 });
  }
}
