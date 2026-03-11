"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Mapping {
  id: number;
  picqerWarehouseId: number;
  picqerWarehouseName: string | null;
  exactDivision: number;
  exactWarehouseCode: string;
  exactWarehouseName: string | null;
}

export default function MappingPage() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [picqerWarehouseId, setPicqerWarehouseId] = useState("");
  const [picqerWarehouseName, setPicqerWarehouseName] = useState("");
  const [exactDivision, setExactDivision] = useState("");
  const [exactWarehouseCode, setExactWarehouseCode] = useState("");
  const [exactWarehouseName, setExactWarehouseName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchMappings = () => {
    fetch("/api/mappings")
      .then((res) => res.json())
      .then((data) => {
        setMappings(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchMappings();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch("/api/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          picqerWarehouseId: parseInt(picqerWarehouseId),
          picqerWarehouseName: picqerWarehouseName || null,
          exactDivision: parseInt(exactDivision),
          exactWarehouseCode,
          exactWarehouseName: exactWarehouseName || null,
        }),
      });

      if (res.ok) {
        setPicqerWarehouseId("");
        setPicqerWarehouseName("");
        setExactDivision("");
        setExactWarehouseCode("");
        setExactWarehouseName("");
        fetchMappings();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Weet je zeker dat je deze mapping wilt verwijderen?")) return;

    await fetch("/api/mappings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    fetchMappings();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Magazijn Mappings</h1>

      {/* Add form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Nieuwe mapping toevoegen</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <Label htmlFor="picqerWarehouseId">Picqer Warehouse ID</Label>
              <Input
                id="picqerWarehouseId"
                type="number"
                value={picqerWarehouseId}
                onChange={(e) => setPicqerWarehouseId(e.target.value)}
                placeholder="bv. 9043"
                required
              />
            </div>
            <div>
              <Label htmlFor="picqerWarehouseName">Picqer Naam</Label>
              <Input
                id="picqerWarehouseName"
                value={picqerWarehouseName}
                onChange={(e) => setPicqerWarehouseName(e.target.value)}
                placeholder="bv. Magazijn Asten"
              />
            </div>
            <div>
              <Label htmlFor="exactDivision">Exact Divisie</Label>
              <Input
                id="exactDivision"
                type="number"
                value={exactDivision}
                onChange={(e) => setExactDivision(e.target.value)}
                placeholder="bv. 2146405"
                required
              />
            </div>
            <div>
              <Label htmlFor="exactWarehouseCode">Exact Warehouse Code</Label>
              <Input
                id="exactWarehouseCode"
                value={exactWarehouseCode}
                onChange={(e) => setExactWarehouseCode(e.target.value)}
                placeholder="bv. 1 of SUPP_OUT"
                required
              />
            </div>
            <div>
              <Label htmlFor="exactWarehouseName">Exact Naam</Label>
              <div className="flex gap-2">
                <Input
                  id="exactWarehouseName"
                  value={exactWarehouseName}
                  onChange={(e) => setExactWarehouseName(e.target.value)}
                  placeholder="bv. Magazijn Asten"
                />
                <Button type="submit" disabled={saving} className="shrink-0">
                  {saving ? "..." : "Toevoegen"}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Mappings table */}
      {loading ? (
        <p className="text-muted-foreground">Laden...</p>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Picqer Warehouse</TableHead>
                <TableHead>Exact Online Warehouse</TableHead>
                <TableHead className="w-[100px]">Acties</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    {m.picqerWarehouseName || "Onbekend"} - Picqer ID: {m.picqerWarehouseId}
                  </TableCell>
                  <TableCell>
                    {m.exactWarehouseName || "Onbekend"} - {m.exactDivision} - Exact Code: {m.exactWarehouseCode}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(m.id)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {mappings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                    Nog geen mappings. Voeg er een toe met het formulier hierboven.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
