import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Check which tables exist
    const tables = await sql(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );

    // Check neon version
    const neonPkg = require("@neondatabase/serverless/package.json");

    return NextResponse.json({
      neonVersion: neonPkg.version,
      dbUrlPrefix: process.env.DATABASE_URL?.substring(0, 30) + "...",
      tables: tables.map((t: { table_name: string }) => t.table_name),
    });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5) : undefined,
    }, { status: 500 });
  }
}
