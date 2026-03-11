import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);

    const tables = await sql(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );

    // Check exact_tokens table structure
    let tokenColumns: Record<string, string>[] = [];
    try {
      tokenColumns = await sql(
        "SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'exact_tokens' ORDER BY ordinal_position"
      );
    } catch { /* table may not exist */ }

    // Check if sequences exist
    let sequences: Record<string, string>[] = [];
    try {
      sequences = await sql(
        "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'"
      );
    } catch { /* ignore */ }

    // Try a test insert+rollback to see exact error
    let insertTest = "not tested";
    try {
      await sql("INSERT INTO exact_tokens (division, access_token, refresh_token, expires_at) VALUES (0, 'test', 'test', NOW())");
      // Clean up test row
      await sql("DELETE FROM exact_tokens WHERE division = 0");
      insertTest = "OK";
    } catch (e: unknown) {
      insertTest = e instanceof Error ? e.message : String(e);
    }

    return NextResponse.json({
      dbUrlPrefix: process.env.DATABASE_URL?.substring(0, 30) + "...",
      tables: tables.map((t: Record<string, string>) => t.table_name),
      tokenColumns,
      sequences: sequences.map((s: Record<string, string>) => s.sequence_name),
      insertTest,
    });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown",
    }, { status: 500 });
  }
}
