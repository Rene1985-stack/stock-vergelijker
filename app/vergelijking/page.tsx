"use client";

import { Suspense, useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
// Card imports kept for sync/error states

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";

interface ComparisonRow {
  sku: string;
  productName: string;
  productType: string;
  costprice: number;
  picqerStock: number;
  picqerReserved: number;
  picqerIncoming: number;
  exactStock: number;
  exactPlannedIn: number;
  exactPlannedOut: number;
  stockDiff: number;
  incomingDiff: number;
  outgoingDiff: number;
  stockImpact: number;
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
  excludedCount: number;
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
  | "productType"
  | "costprice"
  | "picqerStock"
  | "exactStock"
  | "stockDiff"
  | "stockImpact"
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

/** Format currency no decimals (€ 1.234) */
function fmtEuro(n: number): string {
  return n.toLocaleString("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Format currency 2 decimals (€ 0,54) */
function fmtEuro2(n: number): string {
  return n.toLocaleString("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

/** Clickable sort header with drag-to-resize right border */
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
  const arrow = active ? (currentDir === "asc" ? " ▲" : " ▼") : "";
  const thRef = useRef<HTMLTableCellElement>(null);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const th = thRef.current;
      if (!th) return;
      const startX = e.clientX;
      const startW = th.offsetWidth;
      const onMove = (ev: MouseEvent) => {
        th.style.width = `${Math.max(40, startW + ev.clientX - startX)}px`;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    []
  );

  return (
    <TableHead
      ref={thRef}
      className={`select-none relative group ${className ?? ""}`}
      onClick={() => onSort(sortKey)}
      rowSpan={rowSpan}
      style={{ minWidth: 40 }}
    >
      <span className="whitespace-nowrap cursor-pointer hover:text-foreground">{label}{arrow}</span>
      {/* Resize handle */}
      <div
        onMouseDown={onResizeStart}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
      />
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
  const [, setSyncItems] = useState(0);
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
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);

  // Close type dropdown on outside click
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!typeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setTypeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [typeDropdownOpen]);

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
          key === "sku" || key === "productName" || key === "productType" ? "asc" : "desc"
        );
      }
    },
    [sortKey]
  );

  // Collect unique product types from data
  const availableTypes = useMemo(() => {
    if (!data) return [];
    const types = new Set<string>();
    for (const r of data.rows) {
      if (r.productType) types.add(r.productType);
    }
    return Array.from(types).sort((a, b) => a.localeCompare(b, "nl"));
  }, [data]);

  // Default: select only "normal" when data first loads
  const defaultTypeSet = useRef(false);
  useEffect(() => {
    if (data && !defaultTypeSet.current && availableTypes.includes("normal")) {
      setSelectedTypes(new Set(["normal"]));
      defaultTypeSet.current = true;
    }
  }, [data, availableTypes]);

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

    if (selectedTypes.size > 0) {
      rows = rows.filter((r) => selectedTypes.has(r.productType));
    }

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.sku.toLowerCase().includes(q) ||
          r.productName.toLowerCase().includes(q) ||
          r.productType.toLowerCase().includes(q)
      );
    }

    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let cmp: number;
      if (sortKey === "sku" || sortKey === "productName" || sortKey === "productType") {
        cmp = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "", "nl");
      } else {
        cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
      }
      return cmp * dir;
    });

    return rows;
  }, [data, search, showOnlyDiffs, minDiff, hideHighStock, selectedTypes, sortKey, sortDir]);

  // Totals for filtered rows
  const totals = useMemo(() => {
    const t = {
      picqerStock: 0, exactStock: 0, stockDiff: 0, stockImpact: 0,
      picqerIncoming: 0, exactPlannedIn: 0, incomingDiff: 0,
      picqerReserved: 0, exactPlannedOut: 0, outgoingDiff: 0,
    };
    for (const r of filteredRows) {
      t.picqerStock += r.picqerStock;
      t.exactStock += r.exactStock;
      t.stockDiff += r.stockDiff;
      t.stockImpact += r.stockImpact;
      t.picqerIncoming += r.picqerIncoming;
      t.exactPlannedIn += r.exactPlannedIn;
      t.incomingDiff += r.incomingDiff;
      t.picqerReserved += r.picqerReserved;
      t.exactPlannedOut += r.exactPlannedOut;
      t.outgoingDiff += r.outgoingDiff;
    }
    return t;
  }, [filteredRows]);

  // ── Exclude SKU ────────────────────────────────
  const [excludingSku, setExcludingSku] = useState<string | null>(null);

  const handleExclude = useCallback(
    async (sku: string) => {
      if (!mappingId || !data) return;
      setExcludingSku(sku);
      try {
        const res = await fetch("/api/exclusions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mappingId: parseInt(mappingId, 10),
            skus: [sku],
          }),
        });
        if (res.ok) {
          // Remove from local data immediately
          setData((prev) => {
            if (!prev) return prev;
            const newRows = prev.rows.filter((r) => r.sku !== sku);
            return {
              ...prev,
              rows: newRows,
              totalSkus: newRows.length,
              skusWithDifference: newRows.filter((r) => r.hasDifference).length,
              excludedCount: (prev.excludedCount || 0) + 1,
            };
          });
        }
      } finally {
        setExcludingSku(null);
      }
    },
    [mappingId, data]
  );

  const exportCsv = () => {
    if (!filteredRows.length) return;

    const whCode = data?.mapping?.exactWarehouseCode ?? "";
    const whName = data?.mapping?.exactWarehouseName ?? "";
    const exactLabel = `Exact ${whCode} ${whName}`.trim();
    const headers = [
      "SKU",
      "Productnaam",
      "Product Type",
      "Kostprijs",
      "Picqer Voorraad",
      `${exactLabel} Voorraad`,
      "Verschil Voorraad",
      "Impact €",
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
          `"${(r.productType || "").replace(/"/g, '""')}"`,
          r.costprice.toFixed(2).replace(".", ","),
          r.picqerStock,
          r.exactStock,
          r.stockDiff,
          Math.round(r.stockImpact),
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
      {/* Compact header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">Voorraad Vergelijking</h1>
          {data && (
            <span className="text-xs text-muted-foreground">
              {data.mapping.picqerWarehouseName} → {data.mapping.exactWarehouseCode} – {data.mapping.exactWarehouseName}
              {" "}({divisionNames[data.mapping.exactDivision] || `Div. ${data.mapping.exactDivision}`})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <div className="flex items-center gap-3 mr-4 text-xs">
              <span><strong>{fmt(data.totalSkus)}</strong> SKUs</span>
              <span className="text-red-600"><strong>{fmt(data.skusWithDifference)}</strong> verschil</span>
              {(data.excludedCount || 0) > 0 && (
                <span className="text-muted-foreground">{fmt(data.excludedCount)} uitgesloten</span>
              )}
              <span className="text-muted-foreground">{new Date(data.fetchedAt).toLocaleTimeString("nl-NL")}</span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}>
            CSV
          </Button>
          <Button size="sm" onClick={() => startFlow(true)} disabled={isLoading}>
            {isLoading ? "Laden..." : "Vernieuw"}
          </Button>
        </div>
      </div>

      {/* Sync progress */}
      {isLoading && (
        <div className="mb-2 px-3 py-2 rounded border border-blue-200 bg-blue-50 flex items-center gap-2 text-sm">
          <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full flex-shrink-0" />
          <span className="text-blue-800">
            {phase === "syncing" && "Synchroniseren..."}
            {phase === "rate_limited" && "Rate limit, even wachten..."}
            {phase === "comparing" && "Vergelijking berekenen..."}
          </span>
          <span className="text-blue-600 text-xs">{syncMessage}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-2 px-3 py-2 rounded border border-red-200 bg-red-50 flex items-center gap-2 text-sm">
          <span className="text-red-700">{error}</span>
          <Button variant="outline" size="sm" onClick={() => startFlow(true)}>
            Opnieuw
          </Button>
        </div>
      )}

      {data && phase === "done" && (
        <>
          {/* Filters — single compact row */}
          <div className="flex flex-wrap gap-2 mb-2 items-center text-sm">
            <Input
              placeholder="Zoeken..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-48 text-xs"
            />
            <Button
              variant={showOnlyDiffs ? "default" : "outline"}
              onClick={() => setShowOnlyDiffs(!showOnlyDiffs)}
              size="sm"
              className="h-7 text-xs px-2"
            >
              Verschillen ({fmt(data.skusWithDifference)})
            </Button>
            <select
              value={minDiff}
              onChange={(e) => setMinDiff(e.target.value)}
              className="h-7 rounded border border-input bg-background px-2 text-xs"
            >
              <option value="0">Min: alle</option>
              <option value="1">&ge; 1</option>
              <option value="2">&ge; 2</option>
              <option value="5">&ge; 5</option>
              <option value="10">&ge; 10</option>
              <option value="25">&ge; 25</option>
              <option value="50">&ge; 50</option>
              <option value="100">&ge; 100</option>
            </select>
            {/* Type multi-select */}
            {availableTypes.length > 0 && (
              <div className="relative" ref={typeDropdownRef}>
                <button
                  onClick={() => setTypeDropdownOpen(!typeDropdownOpen)}
                  className="h-7 rounded border border-input bg-background px-2 text-xs flex items-center gap-1"
                >
                  Type: {selectedTypes.size === 0 ? "alle" : `${selectedTypes.size}`}
                  <span className="text-[10px]">▾</span>
                </button>
                {typeDropdownOpen && (
                  <div className="absolute z-50 mt-1 bg-background border rounded-md shadow-lg p-2 min-w-[180px] max-h-[300px] overflow-auto">
                    <button
                      onClick={() => setSelectedTypes(new Set())}
                      className="text-xs text-blue-600 hover:underline mb-1 block"
                    >
                      Alles wissen
                    </button>
                    {availableTypes.map((t) => (
                      <label
                        key={t}
                        className="flex items-center gap-2 py-0.5 px-1 hover:bg-muted/50 rounded cursor-pointer text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTypes.has(t)}
                          onChange={() => {
                            setSelectedTypes((prev) => {
                              const next = new Set(prev);
                              if (next.has(t)) next.delete(t);
                              else next.add(t);
                              return next;
                            });
                          }}
                          className="rounded border-gray-300"
                        />
                        {t}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideHighStock}
                onChange={(e) => setHideHighStock(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-muted-foreground whitespace-nowrap">
                &gt;{fmt(MAX_STOCK)} verbergen
              </span>
            </label>
            <span className="text-xs text-muted-foreground">
              {fmt(filteredRows.length)} rijen
            </span>
          </div>

          {/* Comparison table with sticky header — single scroll container */}
          <div className="border rounded-lg overflow-auto" style={{ maxHeight: "calc(100vh - 140px)" }}>
            <table className="w-full caption-bottom text-sm" style={{ tableLayout: "auto" }}>
              <thead className="sticky top-0 z-10 bg-background shadow-sm [&_tr]:border-b">
                <tr>
                  <SortableHead
                    label="SKU"
                    sortKey="sku"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className="align-bottom bg-background"
                    rowSpan={2}
                  />
                  <SortableHead
                    label="Product"
                    sortKey="productName"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className="align-bottom bg-background"
                    rowSpan={2}
                  />
                  <SortableHead
                    label="Type"
                    sortKey="productType"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className="align-bottom bg-background"
                    rowSpan={2}
                  />
                  <SortableHead
                    label="Kostprijs"
                    sortKey="costprice"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className="align-bottom bg-background"
                    rowSpan={2}
                  />
                  <th colSpan={4} className="h-10 px-2 text-center font-medium border-l bg-blue-50">
                    Voorraad
                  </th>
                  <th colSpan={3} className="h-10 px-2 text-center font-medium border-l bg-green-50">
                    Inkomend
                  </th>
                  <th colSpan={3} className="h-10 px-2 text-center font-medium border-l bg-purple-50">
                    Uitgaand
                  </th>
                  <th rowSpan={2} className="w-[40px] bg-background" />
                </tr>
                <tr>
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
                    label="Impact €"
                    sortKey="stockImpact"
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
                </tr>
              </thead>
              <TableBody>
                {/* Totals row */}
                {filteredRows.length > 0 && (
                  <TableRow className="bg-muted/60 font-semibold border-b-2">
                    <TableCell className="text-sm">Totaal</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-center border-l">{fmt(totals.picqerStock)}</TableCell>
                    <TableCell className="text-center">{fmt(totals.exactStock)}</TableCell>
                    <TableCell className={`text-center ${totals.stockDiff === 0 ? "text-green-600" : totals.stockDiff > 0 ? "text-red-600" : "text-orange-600"}`}>
                      {totals.stockDiff > 0 ? `+${fmt(totals.stockDiff)}` : fmt(totals.stockDiff)}
                    </TableCell>
                    <TableCell className={`text-center ${totals.stockImpact === 0 ? "text-green-600" : totals.stockImpact > 0 ? "text-red-600" : "text-orange-600"}`}>
                      {fmtEuro(totals.stockImpact)}
                    </TableCell>
                    <TableCell className="text-center border-l">{fmt(totals.picqerIncoming)}</TableCell>
                    <TableCell className="text-center">{fmt(totals.exactPlannedIn)}</TableCell>
                    <TableCell className={`text-center ${totals.incomingDiff === 0 ? "text-green-600" : totals.incomingDiff > 0 ? "text-red-600" : "text-orange-600"}`}>
                      {totals.incomingDiff > 0 ? `+${fmt(totals.incomingDiff)}` : fmt(totals.incomingDiff)}
                    </TableCell>
                    <TableCell className="text-center border-l">{fmt(totals.picqerReserved)}</TableCell>
                    <TableCell className="text-center">{fmt(totals.exactPlannedOut)}</TableCell>
                    <TableCell className={`text-center ${totals.outgoingDiff === 0 ? "text-green-600" : totals.outgoingDiff > 0 ? "text-red-600" : "text-orange-600"}`}>
                      {totals.outgoingDiff > 0 ? `+${fmt(totals.outgoingDiff)}` : fmt(totals.outgoingDiff)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                )}
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
                    <TableCell className="text-sm text-muted-foreground max-w-[120px] truncate">
                      {row.productType}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                      {row.costprice ? fmtEuro2(row.costprice) : "–"}
                    </TableCell>
                    <TableCell className="text-center border-l">
                      {fmt(row.picqerStock)}
                    </TableCell>
                    <TableCell className="text-center">
                      {fmt(row.exactStock)}
                    </TableCell>
                    <DiffCell value={row.stockDiff} />
                    <TableCell
                      className={`text-center text-sm ${row.stockImpact === 0 ? "text-green-600" : row.stockImpact > 0 ? "text-red-600" : "text-orange-600"}`}
                    >
                      {row.stockImpact !== 0 ? fmtEuro(row.stockImpact) : "–"}
                    </TableCell>
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
                    <TableCell className="text-center p-1">
                      <button
                        onClick={() => handleExclude(row.sku)}
                        disabled={excludingSku === row.sku}
                        className="text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50 text-xs px-1"
                        title={`${row.sku} uitsluiten van vergelijking`}
                      >
                        {excludingSku === row.sku ? "..." : "✕"}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={15}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Geen resultaten gevonden.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
