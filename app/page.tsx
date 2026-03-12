"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Mapping {
  id: number;
  picqerWarehouseId: number;
  picqerWarehouseName: string | null;
  exactDivision: number;
  exactWarehouseCode: string;
  exactWarehouseName: string | null;
}

interface Division {
  Code: number;
  Description: string;
  HID: string;
}

export default function Dashboard() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [divisionNames, setDivisionNames] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/mappings").then((res) => res.json()),
      fetch("/api/exact/divisions").then((res) => res.json()).catch(() => []),
    ])
      .then(([mappingsData, divisionsData]) => {
        setMappings(Array.isArray(mappingsData) ? mappingsData : []);
        if (Array.isArray(divisionsData)) {
          const names: Record<number, string> = {};
          divisionsData.forEach((d: Division) => {
            names[d.Code] = d.Description;
          });
          setDivisionNames(names);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Laden...</p>
      </div>
    );
  }

  if (mappings.length === 0) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-semibold mb-2">Geen mappings gevonden</h2>
        <p className="text-muted-foreground mb-4">
          Maak eerst een warehouse mapping aan om voorraad te vergelijken.
        </p>
        <Link href="/mapping">
          <Button>Mappings beheren</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Overzicht van alle magazijn-vergelijkingen
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {mappings.map((mapping) => (
          <Card key={mapping.id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {mapping.picqerWarehouseName ||
                  `Picqer #${mapping.picqerWarehouseId}`}
              </CardTitle>
              <CardDescription>
                Exact: {mapping.exactWarehouseCode} – {mapping.exactWarehouseName || "?"}
                <br />
                <Badge variant="outline" className="mt-1">
                  {divisionNames[mapping.exactDivision] || `Div. ${mapping.exactDivision}`}
                </Badge>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/vergelijking?mapping_id=${mapping.id}`}>
                <Button className="w-full" size="sm">
                  Vergelijk voorraad
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
