# Oleyn Stock v1 MVP

Inventory, sales and credit (dues) app for small and medium wholesalers in Bangladesh, built for low-cost Android phones on 3G.
Stock and customer dues are **ledgers** (every change is a row with who, when, why and how much), never a single number that gets overwritten.

- **Live URL:** _(added after the first Vercel deploy)_
- **Demo logins**

  | Role | Email | Password |
  | --- | --- | --- |
  | Owner (Kamal Hossain) | owner@oleyn-demo.com | OleynOwner#2026 |
  | Salesperson (Rubel Mia) | sales@oleyn-demo.com | OleynSales#2026 |

  The "Demo as…" buttons on the login page fill these in.
- **Public stock API** (demo key `oleyn-demo-api-key-2026`):

  ```text
  curl -H "x-api-key: oleyn-demo-api-key-2026" "https://<your-app>.vercel.app/api/v1/stock?sku=PRAN-MANGO-250"
  ```

## Stack
React 18 + Vite + Tailwind + React Router · Supabase (Postgres, Auth, Row Level Security, plpgsql functions) · Vercel (hosting + `/api` functions) · Gemini (memo AI) · PostHog (analytics)

## Key decisions
- **Roles are enforced in the database.** Cost, profit and purchases live in Owner-only tables; a Salesperson's request returns zero rows (Row Level Security), whatever the UI does.
- **Overselling:** a Salesperson is refused (`INSUFFICIENT_STOCK`); the Owner can sell more than stock only with a typed reason, which is stored on the movement (`oversell_override = true`) and shown in Stock history. Stock may then go negative and is flagged.
- **Safe save:** every sale, payment and purchase carries a `client_ref` made on the phone; retrying after a network failure returns the first save instead of creating a duplicate.
- **Cancel, never delete:** cancelling an invoice adds reversing stock and due entries (fixes v0 bug FB-011).
- **Supabase keys:** uses the new publishable/secret keys (legacy anon/service_role keys retire in early 2027) under the same variable names.

## Database setup (Supabase SQL Editor, in order)
1. `supabase/01_schema.sql` – tables, sequences, views
2. `supabase/02_security.sql` – Row Level Security rules
3. `supabase/03_functions.sql` – business rules (`create_sale`, `record_payment`, `create_purchase`, `adjust_stock`, `cancel_invoice`)
4. Create the two demo logins in Authentication → Users (auto-confirm), then `supabase/04_seed.sql`
5. `supabase/06_tests.sql` – automatic checks; every row must pass

## Folders
- `src/` the app (pages, components, helpers, `i18n/` English and Bangla labels)
- `api/` Vercel server functions (hold the secret keys)
- `supabase/` SQL files

Built with Claude (Anthropic) as a coding assistant; the PM reviewed and tested every segment.
