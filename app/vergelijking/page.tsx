"use client";

import { Suspense, useEffect, useState, useMemo, useCallback, useRef } from "react";
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

interface Division {
  Code: number;
  Description: string;
  HID: string;
}

interface ComparisonResult {
  mapping: {
    id: number;
    picqerWarehouseName: string | null;
    picqerWarehouseId: number;
    exactWarehouseCode: string;
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

interface SyncResponse {
  status: "complete" | "syncing" | "rate_limited" | "none" | "stale";
  itemsFetched: number;
  pagesThisCall?: number;
  retryAfterMs?: number;
  error?: string;
}

type Phase = "idle" | "syncing" | "rate_limited" | "comparing" | "done" | "error";

type SortKey =
  | "sku"
  | "productName"
  | "picqerStock"
  | "exactStock"
  | "stockDiff"
  | "picqerIncoming"
  | "exactPlannedIn"
  | "incomingDiff"
  | "picqerReserved"
  | "exactPlannedOut"
  | "outgoingDiff";

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
  rowSpan,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
  rowSpan?: number;
}) {
  const active = currentKey === sortKey;
  const arrow = active ? (currentDir === "asc" ? " \u25B2" : " \u25BC") : "";
  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/50 ${className ?? ""}`}
      onClick={() => onSort(sortKey)}
      rowSpan={rowSpan}
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

  const [phase, setPhase] = useState<Phase>("idle");
  const [syncItems, setSyncItems] = useState(0);
  const [syncMessage, setSyncMessage] = useState("");
  const [data, setData] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showOnlyDiffs, setShowOnlyDiffs] = useState(false);
  const [minDiff, setMinDiff] = useState("0");
  const [hideHighStock, setHideHighStock] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("stockDiff");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const abortRef = useRef(false);
  const [divisionNames, setDivisionNames] = useState<Record<number, string>>({});

  // Fetch division names once
  useEffect(() => {
    fetch("/api/exact/divisions")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const names: Record<number, string> = {};
          data.forEach((d: Division) => {
            names[d.Code] = d.Description;
          });
          setDivisionNames(names);
        }
      })
      .catch(() => {});
  }, []);

  // ── Sync + Compare flow ────────────────────────
  const startFlow = useCallback(
    async (reset: boolean) => {
      if (!mappingId) return;
      abortRef.current = false;
      setError(null);
      setPhase("syncing");
      setSyncItems(0);
      setSyncMessage("Synchronisatie starten...");

      try {
        // Step 1: Progressive sync with Exact Online
        let syncDone = false;
        while (!syncDone && !abortRef.current) {
          const res = await fetch("/api/sync-exact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mappingId: parseInt(mappingId, 10), reset }),
          });

          if (!res.ok) {
            const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(body.error || `Sync mislukt (HTTP ${res.status})`);
          }

          const sync: SyncResponse = await res.json();
          setSyncItems(sync.itemsFetched);
          reset = false; // Only reset on first call

          if (sync.status === "complete") {
            syncDone = true;
            setSyncMessage(
              `Sync compleet: ${fmt(sync.itemsFetched)} items opgehaald`
            );
          } else if (sync.status === "rate_limited") {
            const waitSec = Math.ceil((sync.retryAfterMs ?? 60000) / 1000);
            setPhase("rate_limited");
            setSyncMessage(
              `Rate limit bereikt. Wachten ${waitSec}s...`
            );
            // Wait for rate limit reset, then continue
            await new Promise((r) => setTimeout(r, sync.retryAfterMs ?? 60000));
            setPhase("syncing");
            setSyncMessage(
              `Hervatten... ${fmt(sync.itemsFetched)} items tot nu toe`
            );
          } else {
            // syncing — more pages to fetch
            setSyncMessage(
              `Ophalen van Exact Online... ${fmt(sync.itemsFetched)} items (${sync.pagesThisCall ?? 0} pagina's deze ronde)`
            );
          }
        }

        if (abortRef.current) return;

        // Step 2: Fetch comparison (Picqer live + Exact from DB)
        setPhase("comparing");
        setSyncMessage("Vergelijking berekenen met Picqer...");

        const compRes = await fetch(
          `/api/comparison?mapping_id=${mappingId}`
        );
        const text = await compRes.text();

        let json;
        try {
          json = JSON.parse(text);
        } catch {
          if (
            compRes.status === 504 ||
            text.includes("FUNCTION_INVOCATION_TIMEOUT")
          ) {
            throw new Error(
              "Timeout bij het ophalen van Picqer data. Probeer het opnieuw."
            );
          }
          throw new Error(
            `Server error (HTTP ${compRes.status}). Probeer het later opnieuw.`
          );
        }

        if (!compRes.ok) {
          throw new Error(
            json.error || `Vergelijking mislukt (HTTP ${compRes.status})`
          );
        }

        setData(json);
        setPhase("done");
      } catch (err) {
        if (abortRef.current) return;
        setError(err instanceof Error ? err.message : "Onbekende fout");
        setPhase("error");
      }
    },
    [mappingId]
  );

  // Auto-start on page load
  useEffect(() => {
    if (mappingId) {
      startFlow(false);
    }
    return () => {
      abortRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingId]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
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

    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let cmp: number;
      if (sortKey === "sku" || sortKey === "productName") {
        cmp = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "", "nl");
      } else {
        cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
      }
      return cmp * dir;
    });

    return rows;
  }, [data, search, showOnlyDiffs, minDiff, hideHighStock, sortKey, sortDir]);

  const exportCsv = () => {
    if (!filteredRows.length) return;

    const whCode = data?.mapping?.exactWarehouseCode ?? "";
    const whName = data?.mapping?.exactWarehouseName ?? "";
    const exactLabel = `Exact ${whCode} ${whName}`.trim();
    const headers = [
      "SKU",
      "Productnaam",
      "Picqer Voorraad",
      `${exactLabel} Voorraad`,
      "Verschil Voorraad",
      "Picqer Inkomend",
      `${exactLabel} Inkomend`,
      "Verschil Inkomend",
      "Picqer Uitgaand",
      `${exactLabel} Uitgaand`,
      "Verschil Uitgaand",
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
          r.picqerReserved,
          r.exactPlannedOut,
          r.outgoingDiff,
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

  const isLoading = phase === "syncing" || phase === "rate_limited" || phase === "comparing";
  const sharedHeadCls = "text-center";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Voorraad Vergelijking</h1>
          {data && (
            <p className="text-muted-foreground">
              Picqer: {data.mapping.picqerWarehouseName} → Exact:{" "}
              {data.mapping.exactWarehouseCode} – {data.mapping.exactWarehouseName}
              {" "}({divisionNames[data.mapping.exactDivision] || `Div. ${data.mapping.exactDivision}`})
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
          <Button
            onClick={() => startFlow(true)}
            disabled={isLoading}
          >
            {isLoading ? "Laden..." : "Vernieuw"}
          </Button>
        </div>
      </div>

      {/* Sync progress */}
      {isLoading && (
        <Card className="mb-4 border-blue-200 bg-blue-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full flex-shrink-0" />
              <div>
                <p className="text-blue-800 font-medium">
                  {phase === "syncing" && "Synchroniseren met Exact Online..."}
                  {phase === "rate_limited" && "Even wachten op Exact Online..."}
                  {phase === "comparing" && "Vergelijking berekenen..."}
                </p>
                <p className="text-blue-700 text-sm">{syncMessage}</p>
                {syncItems > 0 && phase !== "comparing" && (
                  <p className="text-blue-600 text-xs mt-1">
                    {fmt(syncItems)} Exact Online artikelen opgehaald
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="text-red-700">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => startFlow(true)}
            >
              Opnieuw proberen
            </Button>
          </CardContent>
        </Card>
      )}

      {data && phase === "done" && (
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
                  <SortableHead
                    label="SKU"
                    sortKey="sku"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className="align-bottom"
                    rowSpan={2}
                  />
                  <SortableHead
                    label="Product"
                    sortKey="productName"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className="align-bottom"
                    rowSpan={2}
                  />
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
                  <TableHead
                    colSpan={3}
                    className="text-center border-l bg-purple-50"
                  >
                    Uitgaand
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
                  <SortableHead
                    label="Picqer"
                    sortKey="picqerReserved"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className={`${sharedHeadCls} border-l bg-purple-50`}
                  />
                  <SortableHead
                    label="Exact"
                    sortKey="exactPlannedOut"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className={`${sharedHeadCls} bg-purple-50`}
                  />
                  <SortableHead
                    label="Verschil"
                    sortKey="outgoingDiff"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className={`${sharedHeadCls} bg-purple-50`}
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
                    <TableCell className="text-center border-l">
                      {fmt(row.picqerReserved)}
                    </TableCell>
                    <TableCell className="text-center">
                      {fmt(row.exactPlannedOut)}
                    </TableCell>
                    <DiffCell value={row.outgoingDiff} />
                  </TableRow>
                ))}
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={11}
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
