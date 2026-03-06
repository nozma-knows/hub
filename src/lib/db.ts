import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";
import * as schema from "@/db/schema";

const globalKey = Symbol.for("openclaw-hub.pg.pool");

type GlobalWithPool = typeof globalThis & {
  [globalKey]?: Pool;
};

const globalForPool = globalThis as GlobalWithPool;

const pool =
  globalForPool[globalKey] ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10
  });

if (env.NODE_ENV !== "production") {
  globalForPool[globalKey] = pool;
}

export const db = drizzle({ client: pool, schema });
