import { readFileSync } from 'node:fs'
import { Pool } from 'pg'

const sourcePath =
  process.argv[2] ||
  '/Users/schoolcraft_mbpro/apps/psg/psg-import/src/lib/shops/invoiced-customers.json'

function readEnv(path = '.env.local') {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split(/\n/)
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf('=')
          return [
            line.slice(0, index),
            line.slice(index + 1).replace(/^['"]|['"]$/g, ''),
          ]
        })
    )
  } catch {
    return {}
  }
}

const env = { ...readEnv(), ...process.env }
const connectionString = env.SUPABASE_DB_URL || env.DATABASE_URL

if (!connectionString) {
  throw new Error('SUPABASE_DB_URL or DATABASE_URL is required')
}

const customers = JSON.parse(readFileSync(sourcePath, 'utf8'))
const pool = new Pool({ connectionString })

try {
  await pool.query('BEGIN')
  await pool.query('TRUNCATE invoiced_customers')

  for (const customer of customers) {
    await pool.query(
      `
        INSERT INTO invoiced_customers (
          invoiced_id,
          psg_id,
          name,
          city,
          state,
          parent_invoiced_id,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (invoiced_id) DO UPDATE SET
          psg_id = EXCLUDED.psg_id,
          name = EXCLUDED.name,
          city = EXCLUDED.city,
          state = EXCLUDED.state,
          parent_invoiced_id = EXCLUDED.parent_invoiced_id,
          metadata = EXCLUDED.metadata,
          imported_at = NOW()
      `,
      [
        customer.invoicedId,
        customer.psgId,
        customer.name,
        customer.city || null,
        customer.state || null,
        customer.parentInvoicedId || null,
        JSON.stringify(customer),
      ]
    )
  }

  await pool.query('COMMIT')
  console.log(`Imported ${customers.length} Invoiced customers`)
} catch (error) {
  await pool.query('ROLLBACK')
  throw error
} finally {
  await pool.end()
}
