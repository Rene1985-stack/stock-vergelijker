import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { warehouseMappings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const mappings = await getDb().select().from(warehouseMappings);
    return NextResponse.json(mappings);
  } catch (error: unknown) {
    console.error("Mapping list error:", error);
    let msg = "Unknown error";
    if (error instanceof Error) {
      msg = error.message;
      // Include cause if available (Neon driver nests errors)
      const cause = (error as { cause?: { message?: string } }).cause;
      if (cause?.message) msg += ` | Cause: ${cause.message}`;
    }
    return NextResponse.json({ error: `Failed to fetch mappings: ${msg}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { picqerWarehouseId, picqerWarehouseName, exactDivision, exactWarehouseCode, exactWarehouseName } = body;

    if (!picqerWarehouseId || !exactDivision || !exactWarehouseCode) {
      return NextResponse.json(
        { error: "picqerWarehouseId, exactDivision, and exactWarehouseCode are required" },
        { status: 400 }
      );
    }

    const [mapping] = await getDb()
      .insert(warehouseMappings)
      .values({
        picqerWarehouseId,
        picqerWarehouseName,
        exactDivision,
        exactWarehouseCode,
        exactWarehouseName,
      })
      .returning();

    return NextResponse.json(mapping, { status: 201 });
  } catch (error) {
    console.error("Mapping create error:", error);
    return NextResponse.json({ error: "Failed to create mapping" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const [mapping] = await getDb()
      .update(warehouseMappings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(warehouseMappings.id, id))
      .returning();

    return NextResponse.json(mapping);
  } catch (error) {
    console.error("Mapping update error:", error);
    return NextResponse.json({ error: "Failed to update mapping" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await getDb().delete(warehouseMappings).where(eq(warehouseMappings.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mapping delete error:", error);
    return NextResponse.json({ error: "Failed to delete mapping" }, { status: 500 });
  }
}
