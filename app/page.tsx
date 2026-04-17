"use client";

import Papa from "papaparse";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo, useState } from "react";

type SortKey =
  | "partNumber"
  | "description"
  | "brand"
  | "size"
  | "boltPattern"
  | "offset"
  | "finish"
  | "fuelMap"
  | "tisMap"
  | "difference";

type SortDirection = "asc" | "desc";

type ComparisonRow = {
  partNumber: string;
  description: string;
  brand: string;
  size: string;
  boltPattern: string;
  offset: string;
  finish: string;
  fuelMap: number;
  tisMap: number;
  difference: number;
};

type BrandFilterKey = "all" | "fuel" | "kmc";

type BrandTab = {
  key: BrandFilterKey;
  label: string;
  matches: (row: ComparisonRow) => boolean;
};

const groupedSizeOrder = ["17\"", "18\"", "20\"", "22\"", "24\"", "26\""];
const orange = "#f97316";
const red = "#ef4444";
const card = "#111111";
const border = "#222222";
const brandTabs: BrandTab[] = [
  {
    key: "all",
    label: "All",
    matches: () => true,
  },
  {
    key: "fuel",
    label: "Fuel",
    matches: (row) => row.brand.toLowerCase().startsWith("fuel"),
  },
  {
    key: "kmc",
    label: "KMC",
    matches: (row) => row.brand === "KMC",
  },
];

function parseCurrency(value: string | undefined) {
  if (!value) return 0;
  const normalized = value.replace(/\$/g, "").trim().replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function normalizeSizeBucket(size: string) {
  const match = size.match(/^(\d{2})/);
  return match ? `${match[1]}"` : size;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-5" style={{ backgroundColor: card, borderColor: border }}>
      <div className="text-3xl font-semibold tracking-tight text-white">{value}</div>
      <div className="mt-2 text-sm text-zinc-400">{label}</div>
    </div>
  );
}

export default function Home() {
  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedBrand, setSelectedBrand] = useState<BrandFilterKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("difference");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    fetch("/data.csv")
      .then((response) => response.text())
      .then((text) => {
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim(),
        });
        const nextRows: ComparisonRow[] = [];

        for (const row of parsed.data) {
          if (row.Match_Type?.trim() !== "exact") continue;

          nextRows.push({
            partNumber: row.PartNumber || "",
            description: row.PartDescription || "",
            brand: row.Brand || "",
            size: row.Size || "",
            boltPattern: row.BoltPattern || "",
            offset: row.Offset || "",
            finish: row.Finish || "",
            fuelMap: parseCurrency(row.MAP_USD),
            tisMap: parseCurrency(row.TIS_Comparable_MAP),
            difference: parseCurrency(row.Price_Difference),
          });
        }

        setRows(nextRows);
      });
  }, []);

  const brandCounts = useMemo(
    () =>
      brandTabs.reduce<Record<BrandFilterKey, number>>((counts, tab) => {
        counts[tab.key] = rows.filter(tab.matches).length;
        return counts;
      }, { all: 0, fuel: 0, kmc: 0 }),
    [rows],
  );

  const brandFilteredRows = useMemo(() => {
    const selectedTab = brandTabs.find((tab) => tab.key === selectedBrand) ?? brandTabs[0];
    return rows.filter(selectedTab.matches);
  }, [rows, selectedBrand]);

  const stats = useMemo(() => {
    if (!brandFilteredRows.length) {
      return {
        total: 0,
        avgFuel: 0,
        avgTis: 0,
        avgSavings: 0,
        percentCheaper: 0,
        maxSavings: 0,
      };
    }

    const total = brandFilteredRows.length;
    const fuelTotal = brandFilteredRows.reduce((sum, row) => sum + row.fuelMap, 0);
    const tisTotal = brandFilteredRows.reduce((sum, row) => sum + row.tisMap, 0);
    const cheaperRows = brandFilteredRows.filter((row) => row.tisMap < row.fuelMap);

    return {
      total,
      avgFuel: fuelTotal / total,
      avgTis: tisTotal / total,
      avgSavings: brandFilteredRows.reduce((sum, row) => sum + row.difference, 0) / total,
      percentCheaper: (cheaperRows.length / total) * 100,
      maxSavings: cheaperRows.reduce((max, row) => Math.max(max, row.difference), 0),
    };
  }, [brandFilteredRows]);

  const sizeChartData = useMemo(() => {
    const grouped = new Map<string, { fuelTotal: number; tisTotal: number; count: number }>();

    brandFilteredRows.forEach((row) => {
      const bucket = normalizeSizeBucket(row.size);
      if (!groupedSizeOrder.includes(bucket)) return;
      const current = grouped.get(bucket) ?? { fuelTotal: 0, tisTotal: 0, count: 0 };
      current.fuelTotal += row.fuelMap;
      current.tisTotal += row.tisMap;
      current.count += 1;
      grouped.set(bucket, current);
    });

    return groupedSizeOrder.map((size) => {
      const current = grouped.get(size) ?? { fuelTotal: 0, tisTotal: 0, count: 0 };
      return {
        size,
        fuel: current.count ? Number((current.fuelTotal / current.count).toFixed(0)) : 0,
        tis: current.count ? Number((current.tisTotal / current.count).toFixed(0)) : 0,
      };
    });
  }, [brandFilteredRows]);

  const finishChartData = useMemo(() => {
    const grouped = new Map<string, { savingsTotal: number; count: number }>();

    brandFilteredRows.forEach((row) => {
      const key = row.finish || "Unknown";
      const current = grouped.get(key) ?? { savingsTotal: 0, count: 0 };
      current.savingsTotal += row.difference;
      current.count += 1;
      grouped.set(key, current);
    });

    return Array.from(grouped.entries())
      .map(([finish, value]) => ({
        finish,
        savings: Number((value.savingsTotal / value.count).toFixed(0)),
      }))
      .sort((a, b) => b.savings - a.savings);
  }, [brandFilteredRows]);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    const nextRows = search
      ? brandFilteredRows.filter((row) =>
          [
            row.partNumber,
            row.description,
            row.brand,
            row.size,
            row.boltPattern,
            row.offset,
            row.finish,
          ]
            .join(" ")
            .toLowerCase()
            .includes(search),
        )
      : brandFilteredRows;

    return [...nextRows].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      const modifier = sortDirection === "asc" ? 1 : -1;

      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * modifier;
      }

      return String(aValue).localeCompare(String(bValue), undefined, { numeric: true }) * modifier;
    });
  }, [brandFilteredRows, query, sortDirection, sortKey]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "difference" ? "desc" : "asc");
  }

  const headers: { key: SortKey; label: string }[] = [
    { key: "partNumber", label: "Part Number" },
    { key: "description", label: "Description" },
    { key: "brand", label: "Brand" },
    { key: "size", label: "Size" },
    { key: "boltPattern", label: "Bolt Pattern" },
    { key: "offset", label: "Offset" },
    { key: "finish", label: "Finish" },
    { key: "fuelMap", label: "Fuel MAP" },
    { key: "tisMap", label: "TIS MAP" },
    { key: "difference", label: "Difference" },
  ];

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 lg:px-10">
        <header className="space-y-2">
          <div className="inline-flex rounded-full border px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-400" style={{ borderColor: border }}>
            Tough Insights
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">
            TIS Competitor MAP Comparison
          </h1>
          <p className="text-base text-zinc-400 md:text-lg">Exact size + finish matches only</p>
        </header>

        <section className="flex flex-wrap gap-3">
          {brandTabs.map((tab) => {
            const isActive = tab.key === selectedBrand;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSelectedBrand(tab.key)}
                className="rounded-full border px-4 py-2 text-sm font-medium transition"
                style={{
                  backgroundColor: isActive ? orange : card,
                  borderColor: isActive ? orange : border,
                  color: isActive ? "#0a0a0a" : "#f4f4f5",
                }}
              >
                {tab.label} ({brandCounts[tab.key].toLocaleString()})
              </button>
            );
          })}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <StatCard label="Total Comparisons" value={stats.total.toLocaleString()} />
          <StatCard label={`Avg ${selectedBrand === 'kmc' ? 'KMC' : selectedBrand === 'fuel' ? 'Fuel' : 'Fuel/KMC'} MAP`} value={formatCurrency(stats.avgFuel)} />
          <StatCard label="Avg TIS MAP" value={formatCurrency(stats.avgTis)} />
          <StatCard label="Avg Savings w/ TIS" value={formatCurrency(stats.avgSavings)} />
          <StatCard label="% Where TIS is Cheaper" value={formatPercent(stats.percentCheaper)} />
          <StatCard label="Max Savings" value={formatCurrency(stats.maxSavings)} />
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border p-5" style={{ backgroundColor: card, borderColor: border }}>
            <div className="mb-4">
              <h2 className="text-lg font-medium text-white">Average MAP by Size</h2>
              <p className="text-sm text-zinc-400">{selectedBrand === 'kmc' ? 'KMC' : selectedBrand === 'fuel' ? 'Fuel' : 'Fuel/KMC'} versus TIS average MAP on exact matches</p>
            </div>
            <div className="h-80 min-h-80">
              {mounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sizeChartData}>
                    <CartesianGrid stroke="#1f1f1f" vertical={false} />
                    <XAxis dataKey="size" stroke="#a1a1aa" tickLine={false} axisLine={false} />
                    <YAxis stroke="#a1a1aa" tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0f0f0f", border: `1px solid ${border}`, borderRadius: 12 }}
                      formatter={(value) => formatCurrency(Number(value ?? 0))}
                    />
                    <Legend />
                    <Bar dataKey="fuel" name={selectedBrand === 'kmc' ? 'KMC' : selectedBrand === 'fuel' ? 'Fuel' : 'Fuel/KMC'} fill="#6b7280" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="tis" name="TIS" fill={orange} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border p-5" style={{ backgroundColor: card, borderColor: border }}>
            <div className="mb-4">
              <h2 className="text-lg font-medium text-white">Average Savings by Finish</h2>
              <p className="text-sm text-zinc-400">Higher bars mean stronger TIS pricing advantage</p>
            </div>
            <div className="h-80 min-h-80">
              {mounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={finishChartData} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid stroke="#1f1f1f" horizontal={false} />
                    <XAxis type="number" stroke="#a1a1aa" tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                    <YAxis dataKey="finish" type="category" width={130} stroke="#a1a1aa" tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0f0f0f", border: `1px solid ${border}`, borderRadius: 12 }}
                      formatter={(value) => formatCurrency(Number(value ?? 0))}
                    />
                    <Bar dataKey="savings" radius={[0, 6, 6, 0]}>
                      {finishChartData.map((entry) => (
                        <Cell key={entry.finish} fill={entry.savings >= 0 ? orange : red} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border p-5" style={{ backgroundColor: card, borderColor: border }}>
          <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-medium text-white">Exact-Match Comparison Table</h2>
              <p className="text-sm text-zinc-400">Search and sort every qualifying wheel match</p>
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search part number, size, finish, bolt pattern..."
              className="w-full rounded-xl border bg-[#0b0b0b] px-4 py-3 text-sm text-white outline-none transition md:max-w-sm"
              style={{ borderColor: border }}
            />
          </div>

          <div className="overflow-auto rounded-xl border" style={{ borderColor: border }}>
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-[#141414]">
                <tr>
                  {headers.map((header) => (
                    <th key={header.key} className="px-4 py-3 text-left font-medium text-zinc-300">
                      <button className="flex items-center gap-2" onClick={() => toggleSort(header.key)}>
                        {header.label}
                        <span className="text-xs text-zinc-500">
                          {sortKey === header.key ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, index) => (
                  <tr key={`${row.partNumber}-${row.finish}-${index}`} className={index % 2 === 0 ? "bg-[#101010]" : "bg-[#0d0d0d]"}>
                    <td className="px-4 py-3 text-zinc-200">{row.partNumber}</td>
                    <td className="px-4 py-3 text-zinc-300">{row.description}</td>
                    <td className="px-4 py-3 text-zinc-300">{row.brand}</td>
                    <td className="px-4 py-3 text-zinc-300">{row.size}</td>
                    <td className="px-4 py-3 text-zinc-300">{row.boltPattern}</td>
                    <td className="px-4 py-3 text-zinc-300">{row.offset}</td>
                    <td className="px-4 py-3 text-zinc-300">{row.finish}</td>
                    <td className="px-4 py-3 text-zinc-200">{formatCurrency(row.fuelMap)}</td>
                    <td className="px-4 py-3 text-zinc-200">{formatCurrency(row.tisMap)}</td>
                    <td className={`px-4 py-3 font-medium ${row.tisMap < row.fuelMap ? "text-green-400" : "text-red-400"}`}>
                      {row.tisMap < row.fuelMap ? "-" : "+"}
                      {formatCurrency(Math.abs(row.difference))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
