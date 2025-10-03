import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import dotenv from 'dotenv';

const projectRoot = process.cwd();

const envFiles: Array<{ file: string; override: boolean }> = [
  { file: '.env', override: false },
  { file: '.env.local', override: true },
];

for (const { file, override } of envFiles) {
  const envPath = path.join(projectRoot, file);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override });
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Please configure it in .env.local.');
  process.exit(1);
}

function sanitiseDatabaseName(raw: string) {
  return raw.replace(/"/g, '""');
}

function deriveShadowDatabaseUrl(url: string) {
  const derived = new URL(url);
  const dbName = derived.pathname.replace(/^\//, '');
  const shadowName = dbName ? `${dbName}_shadow` : 'shadow';
  derived.pathname = `/${shadowName}`;
  return derived.toString();
}

let shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;
if (!shadowDatabaseUrl) {
  shadowDatabaseUrl = deriveShadowDatabaseUrl(databaseUrl);
  process.env.SHADOW_DATABASE_URL = shadowDatabaseUrl;
  console.log(`SHADOW_DATABASE_URL was missing. Using derived value: ${shadowDatabaseUrl}`);
}

async function ensureDatabaseExists(url: string) {
  const target = new URL(url);
  const dbName = target.pathname.replace(/^\//, '');
  if (!dbName) {
    throw new Error('Unable to determine database name from connection string.');
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';

  const adminClient = new Client({ connectionString: admin.toString() });
  await adminClient.connect();

  try {
    const existing = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (existing.rowCount && existing.rowCount > 0) {
      return false;
    }

    const sql = `CREATE DATABASE "${sanitiseDatabaseName(dbName)}"`;
    await adminClient.query(sql);
    return true;
  } finally {
    await adminClient.end();
  }
}

function listMigrationDirectories() {
  const migrationsDir = path.join(projectRoot, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return [] as string[];
  }

  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'node_modules');
}

async function getAppliedMigrations(url: string) {
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const result = await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
    return new Set(result.rows.map((row) => row.migration_name as string));
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const pgCode = (error as { code?: string }).code;
      if (pgCode === '42P01') {
        return new Set<string>();
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}

async function runPrismaMigrate(env: Record<string, string>) {
  const cmd = Bun.spawn({
    cmd: ['bunx', '--bun', 'prisma', 'migrate', 'deploy'],
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: projectRoot,
    env,
  });

  const exitCode = await cmd.exited;
  if (exitCode !== 0) {
    throw new Error('Prisma migrate deploy failed. Review the logs above for details.');
  }
}

async function main() {
  console.log('Ensuring primary database exists...');
  const createdPrimary = await ensureDatabaseExists(databaseUrl);
  if (createdPrimary) {
    console.log('Created database for application.');
  }

  console.log('Ensuring shadow database exists...');
  const createdShadow = await ensureDatabaseExists(shadowDatabaseUrl!);
  if (createdShadow) {
    console.log('Created shadow database for Prisma.');
  }

  const expectedMigrations = listMigrationDirectories();
  if (expectedMigrations.length === 0) {
    console.log('No migrations directory found; skipping Prisma migrate deploy.');
    return;
  }

  console.log('Checking applied migrations...');
  const applied = await getAppliedMigrations(databaseUrl);
  const pending = expectedMigrations.filter((name) => !applied.has(name));

  if (pending.length === 0) {
    console.log('All migrations already applied.');
    return;
  }

  console.log(`Applying ${pending.length} pending migration(s)...`);
  await runPrismaMigrate({
    ...process.env,
    DATABASE_URL: databaseUrl,
    SHADOW_DATABASE_URL: shadowDatabaseUrl!,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
