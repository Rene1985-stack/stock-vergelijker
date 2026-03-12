"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TokenStatus {
  connected: boolean;
  division: number | null;
  updatedAt: string | null;
}

interface Exclusion {
  id: number;
  mapping_id: number;
  sku: string;
  created_at: string;
}

interface Mapping {
  id: number;
  picqerWarehouseName: string | null;
  exactWarehouseCode: string;
  exactWarehouseName: string | null;
  exactDivision: number;
}

export default function InstellingenPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Laden...</p></div>}>
      <InstellingenPage />
    </Suspense>
  );
}

function InstellingenPage() {
  const searchParams = useSearchParams();
  const connected = searchParams.get("connected");
  const error = searchParams.get("error");

  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [picqerStatus, setPicqerStatus] = useState<"checking" | "ok" | "error">("checking");
  const [picqerError, setPicqerError] = useState<string | null>(null);

  // Exclusions state
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [exclusionsLoading, setExclusionsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/exact/token")
      .then((res) => res.json())
      .then((data) => {
        setTokenStatus(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/picqer/warehouses")
      .then(async (res) => {
        if (res.ok) {
          setPicqerStatus("ok");
        } else {
          const data = await res.json().catch(() => ({}));
          setPicqerError(data.error || `HTTP ${res.status}`);
          setPicqerStatus("error");
        }
      })
      .catch((err) => {
        setPicqerError(err.message);
        setPicqerStatus("error");
      });

    // Fetch exclusions and mappings
    Promise.all([
      fetch("/api/exclusions").then((res) => res.json()).catch(() => []),
      fetch("/api/mappings").then((res) => res.json()).catch(() => []),
    ]).then(([excls, maps]) => {
      setExclusions(Array.isArray(excls) ? excls : []);
      setMappings(Array.isArray(maps) ? maps : []);
      setExclusionsLoading(false);
    });
  }, []);

  const getMappingLabel = (mappingId: number) => {
    const m = mappings.find((m) => m.id === mappingId);
    if (!m) return `Mapping #${mappingId}`;
    return `${m.picqerWarehouseName || "?"} → ${m.exactWarehouseCode} ${m.exactWarehouseName || ""}`.trim();
  };

  const handleDeleteExclusion = async (exclusion: Exclusion) => {
    setDeletingId(exclusion.id);
    try {
      const res = await fetch("/api/exclusions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: exclusion.id }),
      });
      if (res.ok) {
        setExclusions((prev) => prev.filter((e) => e.id !== exclusion.id));
      }
    } finally {
      setDeletingId(null);
    }
  };

  // Group exclusions by mapping_id
  const exclusionsByMapping = exclusions.reduce<Record<number, Exclusion[]>>((acc, e) => {
    if (!acc[e.mapping_id]) acc[e.mapping_id] = [];
    acc[e.mapping_id].push(e);
    return acc;
  }, {});

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Instellingen</h1>

      {connected && (
        <div className="mb-4 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800">
          Exact Online succesvol verbonden!
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800">
          Verbinding met Exact Online mislukt: {decodeURIComponent(error)}
        </div>
      )}

      <div className="grid gap-6">
        {/* Picqer connection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Picqer
              {picqerStatus === "checking" && (
                <Badge variant="outline">Controleren...</Badge>
              )}
              {picqerStatus === "ok" && (
                <Badge className="bg-green-100 text-green-800">Verbonden</Badge>
              )}
              {picqerStatus === "error" && (
                <Badge variant="destructive">Niet verbonden</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Picqer WMS API connectie. Configureer via environment variables.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {picqerError && (
              <p className="text-sm text-red-600 mb-2">{picqerError}</p>
            )}
            <p className="text-sm text-muted-foreground">
              Stel <code className="bg-muted px-1 rounded">PICQER_API_KEY</code> en{" "}
              <code className="bg-muted px-1 rounded">PICQER_BASE_URL</code> in als
              environment variables in Vercel.
            </p>
          </CardContent>
        </Card>

        {/* Exact Online connection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Exact Online
              {loading ? (
                <Badge variant="outline">Controleren...</Badge>
              ) : tokenStatus?.connected ? (
                <Badge className="bg-green-100 text-green-800">Verbonden</Badge>
              ) : (
                <Badge variant="destructive">Niet verbonden</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Eenmalige OAuth2 koppeling. Eén verbinding werkt voor alle administraties/divisies.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <a href="/api/exact/auth">
                <Button>
                  {tokenStatus?.connected ? "Opnieuw verbinden" : "Verbind met Exact Online"}
                </Button>
              </a>

              {tokenStatus?.connected && tokenStatus.updatedAt && (
                <p className="text-sm text-muted-foreground">
                  Laatst verbonden: {new Date(tokenStatus.updatedAt).toLocaleString("nl-NL")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Excluded SKUs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Uitgesloten producten
              <Badge variant="outline">{exclusions.length}</Badge>
            </CardTitle>
            <CardDescription>
              Producten die uitgesloten zijn van de vergelijking. Per mapping apart instelbaar.
              Uitsluiten kan direct vanuit de vergelijkingstabel via het ✕ knopje.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {exclusionsLoading ? (
              <p className="text-sm text-muted-foreground">Laden...</p>
            ) : exclusions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Geen uitgesloten producten. Gebruik het ✕ knopje in de vergelijkingstabel om producten uit te sluiten.
              </p>
            ) : (
              <div className="space-y-4">
                {Object.entries(exclusionsByMapping).map(([mappingIdStr, excls]) => (
                  <div key={mappingIdStr}>
                    <h4 className="text-sm font-medium mb-2">
                      {getMappingLabel(parseInt(mappingIdStr, 10))}
                    </h4>
                    <div className="border rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead>Toegevoegd</TableHead>
                            <TableHead className="w-[80px]">Actie</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {excls.map((e) => (
                            <TableRow key={e.id}>
                              <TableCell className="font-mono text-sm">{e.sku}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {new Date(e.created_at).toLocaleDateString("nl-NL")}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={deletingId === e.id}
                                  onClick={() => handleDeleteExclusion(e)}
                                >
                                  {deletingId === e.id ? "..." : "Herstel"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
