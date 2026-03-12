import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

async function ensureTable() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql(`
    CREATE TABLE IF NOT EXISTS excluded_skus (
      id SERIAL PRIMARY KEY,
      mapping_id INTEGER NOT NULL,
      sku VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(mapping_id, sku)
    )
  `);
  return sql;
}

// GET /api/exclusions?mapping_id=1  — list exclusions for a mapping
// GET /api/exclusions                — list all exclusions
export async function GET(request: NextRequest) {
  try {
    const sql = await ensureTable();
    const mappingId = request.nextUrl.searchParams.get("mapping_id");

    let rows;
    if (mappingId) {
      rows = await sql(
        "SELECT * FROM excluded_skus WHERE mapping_id = $1 ORDER BY sku",
        [parseInt(mappingId, 10)]
      );
    } else {
      rows = await sql(
        "SELECT * FROM excluded_skus ORDER BY mapping_id, sku"
      );
    }

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Exclusions GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch exclusions" },
      { status: 500 }
    );
  }
}

// POST /api/exclusions  — add exclusion(s)
// Body: { mappingId: number, skus: string[] }
export async function POST(request: NextRequest) {
  try {
    const sql = await ensureTable();
    const body = await request.json();
    const { mappingId, skus } = body as { mappingId: number; skus: string[] };

    if (!mappingId || !skus?.length) {
      return NextResponse.json(
        { error: "mappingId and skus[] are required" },
        { status: 400 }
      );
    }

    // Insert each SKU (ignore duplicates)
    for (const sku of skus) {
      await sql(
        `INSERT INTO excluded_skus (mapping_id, sku)
         VALUES ($1, $2)
         ON CONFLICT (mapping_id, sku) DO NOTHING`,
        [mappingId, sku]
      );
    }

    return NextResponse.json({ added: skus.length });
  } catch (error) {
    console.error("Exclusions POST error:", error);
    return NextResponse.json(
      { error: "Failed to add exclusions" },
      { status: 500 }
    );
  }
}

// DELETE /api/exclusions  — remove exclusion(s)
// Body: { mappingId: number, skus: string[] } or { id: number }
export async function DELETE(request: NextRequest) {
  try {
    const sql = await ensureTable();
    const body = await request.json();

    if (body.id) {
      await sql("DELETE FROM excluded_skus WHERE id = $1", [body.id]);
      return NextResponse.json({ deleted: 1 });
    }

    const { mappingId, skus } = body as { mappingId: number; skus: string[] };
    if (!mappingId || !skus?.length) {
      return NextResponse.json(
        { error: "mappingId and skus[], or id required" },
        { status: 400 }
      );
    }

    for (const sku of skus) {
      await sql(
        "DELETE FROM excluded_skus WHERE mapping_id = $1 AND sku = $2",
        [mappingId, sku]
      );
    }

    return NextResponse.json({ deleted: skus.length });
  } catch (error) {
    console.error("Exclusions DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete exclusions" },
      { status: 500 }
    );
  }
}
