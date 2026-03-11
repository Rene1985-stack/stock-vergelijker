"use client";

import { Suspense, useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ComparisonRow {
  sku: string;
  productName: string;
  picqerStock: number;
  picqerReserved: number;
  picqerIncoming: number;
  exactStock: number;
  exactPlannedIn: number;
  exactPlannedOut: number;
  stockDiff: number;
  incomingDiff: number;
  outgoingDiff: number;
  hasDifference: boolean;
}

interface ComparisonResult {
  mapping: {
    id: number;
    picqerWarehouseName: string | null;
    exactWarehouseName: string | null;
    exactDivision: number;
  };
  rows: ComparisonRow[];
  totalSkus: number;
  skusWithDifference: number;
  fetchedAt: string;
  fromCache: boolean;
  exactComplete: boolean;
  exactItemCount: number;
  exactPageCount: number;
}

type SortKey =
  | "sku"
  | "productName"
  | "picqerStock"
  | "exactStock"
  | "stockDiff"
  | "picqerIncoming"
  | "exactPlannedIn"
  | "incomingDiff";

type SortDir = "asc" | "desc";

const MAX_STOCK = 100_000;

/** Format number with Dutch thousand separators (dots) */
function fmt(n: number): string {
  return n.toLocaleString("nl-NL");
}

function DiffCell({ value }: { value: number }) {
  if (value === 0)
    return <TableCell className="text-center text-green-600">0</TableCell>;
  return (
    <TableCell
      className={`text-center font-medium ${value > 0 ? "text-red-600" : "text-orange-600"}`}
    >
      {value > 0 ? `+${fmt(value)}` : fmt(value)}
    </TableCell>
  );
}

/** Clickable sort header */
function SortableHead({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = currentKey === sortKey;
  const arrow = active ? (currentDir === "asc" ? " \u25B2" : " \u25BC") : "";
  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/50 ${className ?? ""}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {arrow}
    </TableHead>
  );
}

export default function VergelijkingPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">Laden...</p>
        </div>
      }
    >
      <VergelijkingPage />
    </Suspense>
  );
}

function VergelijkingPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams.get("mapping_id");

  const [data, setData] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showOnlyDiffs, setShowOnlyDiffs] = useState(false);
  const [minDiff, setMinDiff] = useState("0");
  const [hideHighStock, setHideHighStock] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("stockDiff");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchComparison = () => {
    if (!mappingId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/comparison?mapping_id=${mappingId}`)
      .then(async (res) => {
        const text = await res.text();

        // Handle non-JSON responses (timeouts, server errors return HTML)
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          if (
            res.status === 504 ||
            text.includes("FUNCTION_INVOCATION_TIMEOUT")
          ) {
            throw new Error(
              "Timeout: het ophalen duurde te lang (>60s). " +
                "Probeer het opnieuw \u2014 de cache wordt geleidelijk opgebouwd."
            );
          }
          throw new Error(
            `Server error (HTTP ${res.status}). Probeer het later opnieuw.`
          );
        }

        if (!res.ok) {
          throw new Error(
            json.error || `Vergelijking mislukt (HTTP ${res.status})`
          );
        }
        return json;
      })
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchComparison();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingId]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        // Default: numbers descending, text ascending
        setSortDir(
          key === "sku" || key === "productName" ? "asc" : "desc"
        );
      }
    },
    [sortKey]
  );

  const filteredRows = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    const threshold = parseInt(minDiff, 10) || 0;

    // Filter out products with extreme stock values (test/dummy data)
    if (hideHighStock) {
      rows = rows.filter(
        (r) =>
          Math.abs(r.picqerStock) <= MAX_STOCK &&
          Math.abs(r.exactStock) <= MAX_STOCK
      );
    }

    if (showOnlyDiffs) {
      rows = rows.filter((r) => r.hasDifference);
    }

    if (threshold > 0) {
      rows = rows.filter(
        (r) =>
          Math.abs(r.stockDiff) >= threshold ||
          Math.abs(r.incomingDiff) >= threshold
      );
    }

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.sku.toLowerCase().includes(q) ||
          r.productName.toLowerCase().includes(q)
      );
    }

    // Sort
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let cmp: number;
      if (sortKey === "sku" || sortKey === "productName") {
        cmp = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "", "nl");
      } else if (sortKey === "stockDiff" || sortKey === "incomingDiff") {
        // Sort by absolute value for diff columns (biggest differences first)
        cmp = Math.abs(a[sortKey]) - Math.abs(b[sortKey]);
      } else {
        cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
      }
      return cmp * dir;
    });

    return rows;
  }, [data, search, showOnlyDiffs, minDiff, hideHighStock, sortKey, sortDir]);

  const exportCsv = () => {
    if (!filteredRows.length) return;

    const headers = [
      "SKU",
      "Productnaam",
      "Picqer Voorraad",
      "Exact Voorraad",
      "Verschil Voorraad",
      "Picqer Inkomend",
      "Exact Inkomend",
      "Verschil Inkomend",
    ];

    const csvRows = [
      headers.join(";"),
      ...filteredRows.map((r) =>
        [
          r.sku,
          `"${r.productName.replace(/"/g, '""')}"`,
          r.picqerStock,
          r.exactStock,
          r.stockDiff,
          r.picqerIncoming,
          r.exactPlannedIn,
          r.incomingDiff,
        ].join(";")
      ),
    ];

    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-vergelijking-${mappingId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!mappingId) {
    return (
      <p className="text-muted-foreground">Geen mapping_id opgegeven.</p>
    );
  }

  const sharedHeadCls = "text-center";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Voorraad Vergelijking</h1>
          {data && (
            <p className="text-muted-foreground">
              {data.mapping.picqerWarehouseName} vs{" "}
              {data.mapping.exactWarehouseName} (Div.{" "}
              {data.mapping.exactDivision})
              {data.fromCache && (
                <Badge variant="outline" className="ml-2">
                  Cache
                </Badge>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!data}>
            Export CSV
          </Button>
          <Button onClick={fetchComparison} disabled={loading}>
            {loading ? "Laden..." : "Vernieuw"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="text-red-700">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          <p className="text-muted-foreground">
            Data ophalen uit Picqer en Exact Online...
          </p>
          <p className="text-xs text-muted-foreground">
            Dit kan tot 60 seconden duren bij grote magazijnen.
          </p>
        </div>
      )}

      {data && !data.exactComplete && (
        <Card className="mb-4 border-orange-300 bg-orange-50">
          <CardContent className="pt-4">
            <p className="text-orange-800 font-medium">
              ⚠ Onvolledige Exact Online data
            </p>
            <p className="text-orange-700 text-sm mt-1">
              Exact Online heeft te veel artikelen voor een enkele request
              ({fmt(data.exactItemCount)} opgehaald in {data.exactPageCount} pagina&apos;s,
              maar er zijn meer). Artikelen die niet opgehaald zijn tonen Exact 0.
              De data wordt niet gecached — bij de volgende poging wordt opnieuw opgehaald.
            </p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Totaal SKUs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{fmt(data.totalSkus)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Met verschil
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600">
                  {fmt(data.skusWithDifference)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Opgehaald
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {new Date(data.fetchedAt).toLocaleTimeString("nl-NL")}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4 mb-4 items-center">
            <Input
              placeholder="Zoek op SKU of productnaam..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Button
              variant={showOnlyDiffs ? "default" : "outline"}
              onClick={() => setShowOnlyDiffs(!showOnlyDiffs)}
              size="sm"
            >
              Alleen verschillen ({fmt(data.skusWithDifference)})
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                Min. verschil:
              </span>
              <select
                value={minDiff}
                onChange={(e) => setMinDiff(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="0">Alle</option>
                <option value="1">&ge; 1</option>
                <option value="2">&ge; 2</option>
                <option value="5">&ge; 5</option>
                <option value="10">&ge; 10</option>
                <option value="25">&ge; 25</option>
                <option value="50">&ge; 50</option>
                <option value="100">&ge; 100</option>
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideHighStock}
                onChange={(e) => setHideHighStock(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-muted-foreground whitespace-nowrap">
                Verberg &gt;{fmt(MAX_STOCK)} voorraad
              </span>
            </label>
            <span className="text-sm text-muted-foreground self-center">
              {fmt(filteredRows.length)} resultaten
            </span>
          </div>

          {/* Comparison table */}
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="align-bottom">
                    SKU
                  </TableHead>
                  <TableHead rowSpan={2} className="align-bottom">
                    Product
                  </TableHead>
                  <TableHead
                    colSpan={3}
                    className="text-center border-l bg-blue-50"
                  >
                    Voorraad
                  </TableHead>
                  <TableHead
                    colSpan={3}
                    className="text-center border-l bg-green-50"
                  >
                    Inkomend
                  </TableHead>
                </TableRow>
                <TableRow>
                  <SortableHead
                    label="Picqer"
                    sortKey="picqerStock"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className={`${sharedHeadCls} border-l bg-blue-50`}
                  />
                  <SortableHead
                    label="Exact"
                    sortKey="exactStock"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className={`${sharedHeadCls} bg-blue-50`}
                  />
                  <SortableHead
                    label="Verschil"
                    sortKey="stockDiff"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className={`${sharedHeadCls} bg-blue-50`}
                  />
                  <SortableHead
                    label="Picqer"
                    sortKey="picqerIncoming"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className={`${sharedHeadCls} border-l bg-green-50`}
                  />
                  <SortableHead
                    label="Exact"
                    sortKey="exactPlannedIn"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className={`${sharedHeadCls} bg-green-50`}
                  />
                  <SortableHead
                    label="Verschil"
                    sortKey="incomingDiff"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className={`${sharedHeadCls} bg-green-50`}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow
                    key={row.sku}
                    className={row.hasDifference ? "bg-red-50/50" : ""}
                  >
                    <TableCell className="font-mono text-sm">
                      {row.sku}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {row.productName}
                    </TableCell>
                    <TableCell className="text-center border-l">
                      {fmt(row.picqerStock)}
                    </TableCell>
                    <TableCell className="text-center">
                      {fmt(row.exactStock)}
                    </TableCell>
                    <DiffCell value={row.stockDiff} />
                    <TableCell className="text-center border-l">
                      {fmt(row.picqerIncoming)}
                    </TableCell>
                    <TableCell className="text-center">
                      {fmt(row.exactPlannedIn)}
                    </TableCell>
                    <DiffCell value={row.incomingDiff} />
                  </TableRow>
                ))}
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Geen resultaten gevonden.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
