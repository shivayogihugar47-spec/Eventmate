/**
 * Migration script – reads /db/schema.sql and executes it against Neon.
 * Run with: npm run db:migrate
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  // Use the direct (unpooled) connection for DDL — PgBouncer in transaction
  // mode cannot run multi-statement schema scripts reliably.
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌  DATABASE_URL / DATABASE_URL_UNPOOLED is not set. Add it to .env.local and retry.");
    process.exit(1);
  }

  const schemaPath = join(process.cwd(), "db", "schema.sql");
  const sql = neon(databaseUrl);

  console.log("📂  Reading schema from", schemaPath);
  const schemaSql = readFileSync(schemaPath, "utf-8");

  // Split the script into individual statements: strip `--` line comments first,
  // then split on ";". Each statement is executed separately because the Neon
  // HTTP driver runs one statement per query.
  const statements = schemaSql
    .split("\n")
    .map((line) => (line.trim().startsWith("--") ? "" : line))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`🚀  Running ${statements.length} statement(s) against Neon …`);
  for (const statement of statements) {
    await sql.query(statement);
  }

  console.log("✅  Migration complete.");
}

main().catch((err) => {
  console.error("❌  Migration failed:", err);
  process.exit(1);
});
