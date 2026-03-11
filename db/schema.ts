import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  numeric,
  unique,
} from "drizzle-orm/pg-core";

export const warehouseMappings = pgTable("warehouse_mappings", {
  id: serial("id").primaryKey(),
  picqerWarehouseId: integer("picqer_warehouse_id").notNull(),
  picqerWarehouseName: varchar("picqer_warehouse_name", { length: 255 }),
  exactDivision: integer("exact_division").notNull(),
  exactWarehouseCode: varchar("exact_warehouse_code", { length: 50 }).notNull(),
  exactWarehouseName: varchar("exact_warehouse_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const exactTokens = pgTable("exact_tokens", {
  id: serial("id").primaryKey(),
  division: integer("division").notNull().unique(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const stockCache = pgTable(
  "stock_cache",
  {
    id: serial("id").primaryKey(),
    mappingId: integer("mapping_id")
      .notNull()
      .references(() => warehouseMappings.id, { onDelete: "cascade" }),
    sku: varchar("sku", { length: 255 }).notNull(),
    productName: varchar("product_name", { length: 500 }),
    picqerStock: integer("picqer_stock").default(0),
    picqerReserved: integer("picqer_reserved").default(0),
    picqerIncoming: integer("picqer_incoming").default(0),
    exactStock: numeric("exact_stock").default("0"),
    exactPlannedIn: numeric("exact_planned_in").default("0"),
    exactPlannedOut: numeric("exact_planned_out").default("0"),
    fetchedAt: timestamp("fetched_at").defaultNow(),
  },
  (table) => ({
    uniqueMappingSku: unique().on(table.mappingId, table.sku),
  })
);

// Types
export type WarehouseMapping = typeof warehouseMappings.$inferSelect;
export type NewWarehouseMapping = typeof warehouseMappings.$inferInsert;
export type ExactToken = typeof exactTokens.$inferSelect;
export type StockCacheEntry = typeof stockCache.$inferSelect;
