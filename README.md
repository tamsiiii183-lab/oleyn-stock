# Oleyn Stock v1 MVP

**Live:** https://oleyn-stock.vercel.app

Oleyn Stock is an inventory, sales and credit app for small and medium wholesalers in Bangladesh who today keep part of the business in a paper *khata*, WhatsApp and Excel. It runs on a low-cost Android phone on 3G, in English or Bangla. Stock and customer dues are **ledgers** — every change is a row with who, when, why and how much — so numbers are always traceable. Version 1 also starts the phased ERP for the launch partner Rahman Group with light HR, payroll, accounts, production and multi-godown modules.

## Demo logins

| Role | Email | Password |
| --- | --- | --- |
| Owner (Kamal Hossain) | owner@oleyn-demo.com | OleynOwner#2026 |
| Salesperson (Rubel Mia) | sales@oleyn-demo.com | OleynSales#2026 |

The "Demo as…" buttons on the login page fill these in. The app opens with 21 products, 8 customers, sales, dues, purchases, 6 Rahman Group employees and 3 stock locations.

## Public stock API

```text
curl -H "x-api-key: oleyn-demo-api-key-2026" "https://oleyn-stock.vercel.app/api/v1/stock?sku=PRAN-MANGO-250"
```

Returns `{sku, name, unit, current_stock, low_stock, as_of}` — never cost or profit. Also `?barcode=2000000000017`. Errors: 400 no sku/barcode, 401 wrong key, 404 unknown product, 405 not GET. Only the SHA-256 hash of the key is stored. Details: Owner → More → API key info.

## Stack and architecture

React 18 + Vite + Tailwind + React Router · Supabase (Postgres, Auth, Row Level Security, plpgsql functions) · Vercel (hosting + `/api` server functions) · Google Gemini (memo AI) · PostHog (analytics)

```text
 Phone browser (React app, public keys only)
   │  login + data (Supabase JS, user's session)          analytics events
   ├──────────────────────────────►  Supabase Postgres  ◄──┐       │
   │   tables protected by RLS;      business rules in      │       ▼
   │   writes only through           SECURITY DEFINER        │    PostHog
   │   functions (create_sale, …)    functions + ledgers     │
   │                                                         │ service key (server only)
   │  /api/extract-memo  ─────────►  Vercel function ────────┤──► Google Gemini (20 s timeout)
   │  /api/v1/stock      ◄────────  Vercel function ─────────┘
 Partner system (x-api-key)
```

**Tapping "Save invoice":** the phone sends `create_sale(client_ref, customer, lines, paid_now…)` → the database checks the role, locks the products, applies the oversell rule, calculates totals, writes the invoice, lines, line costs, one stock-out movement per line and the unpaid part to the dues ledger — all in one transaction — and returns the new stock and due.

## Key decisions

- **Roles are enforced by the database, not the screen.** Cost, profit, purchases, payroll and the activity log are Owner-only (Row Level Security). A Salesperson's direct request returns zero rows.
- **Overselling (spec 7.2):** a Salesperson is refused ("Only N in stock"). The Owner can sell above stock only after typing a reason; the movement is flagged `oversell_override` with the reason and shows in Stock history; stock may go negative and is shown in Rust. Why: it stops staff overselling (feedback FB-012) while the accountable person can sell goods that arrived but are not entered yet. The product row lock means two people can't both sell the last unit.
- **Stock and dues are ledgers.** Current stock = sum of `stock_movements`; a customer's due = sum of `customer_ledger`. Rows can only be added (database guard), never edited or deleted. This replaces v0's single `current_stock` column, which made changes untraceable.
- **Safe save:** every sale, payment and purchase carries a `client_ref` made on the phone and kept with the draft. A retry after a network failure returns the first save, never a duplicate (FB-086).
- **Cancel, never delete:** cancelling an invoice adds reversing stock and due entries (fixes v0 bug FB-011).
- **Supabase keys:** the new publishable/secret keys are used under the spec's variable names (legacy anon/service_role keys retire in early 2027).

## AI feature: memo photo → purchase

The phone shrinks the photo (max 1600 px, JPEG 0.7) and sends it to `/api/extract-memo`. The server checks the login, sends the photo with the spec prompt and a JSON schema to **Gemini (`gemini-3.8-flash`, set by `GEMINI_MODEL`)** with a **20-second timeout**, matches items to products, checks qty × price against line totals and the memo total, and logs every attempt in `ai_extractions`. The review screen shows the photo above the lines; uncertain fields get a Signal Orange "Check this"; **nothing is saved until the Owner fixes them and ticks "I checked this memo"**. **Fallback:** on timeout, error, rate limit or bad JSON the same form opens empty with the photo, and `ai_fallback_used` is sent. A Salesperson can also scan a memo to *receive* stock: the server removes every price, and the Owner approves with costs before stock goes up.

## Analytics (PostHog)

Events, sent only after a successful save, each with role, language and app_version: `user_logged_in`, `product_created`, `invoice_saved` (payment_type, lines, total_bdt, **is_first_real_invoice** = activation, oversell_override, used_barcode), `payment_recorded`, `purchase_saved`, `ai_memo_extracted`, `ai_fallback_used`, `stock_adjusted` (+ `language_switched`, `coming_soon_interest`, `purchase_request_sent`, `feedback_sent`).

Dashboard **"Oleyn activation"**: funnel logged in → first real invoice → payment recorded; invoices per day by payment type; AI read vs fallback per day. Link: https://us.posthog.com/project/764855/dashboard/2407854 *(PostHog dashboards are private; evaluators need an invite or a shared link)*.

## Beyond the spec: light ERP modules for Rahman Group (Owner only)

- **HR:** staff by factory, raises with salary history, salary advances, leave balances (assumed casual 10 / sick 14 / annual 18 days a year), "increment due" tick (12+ months since last raise, +5% expected).
- **Payroll:** attendance, worker overtime (assumed 2 × hourly rate), Eid-ul-Fitr / Eid-ul-Adha / year-end bonus, salary sheet, approve (locks the month), payslips.
- **Accounts:** cash in/out, receivables and a simple P&L per month, calculated from sales, payments, purchases and payroll.
- **Production:** bill of materials and production runs through the stock ledger (Rahman Snack Box demo); cost per unit from components.
- **Godowns & branches:** stock per location from one shared ledger; Owner transfers between Main Godown, Narayanganj Branch and Dhaka Shop.
- **Supervision:** who did what and when (sales, payments, stock, price edits, HR), recorded by database triggers, with old → new values for edits.
- **Feedback** for both roles; **Shrobon** (assistant) shown as a "Coming soon" placeholder.

## Known limitations

- No full offline sync across phones yet (MVP has safe save with drafts and retry); planned for the 6-week v1.
- Payroll lite only: no leave approval workflow, income tax, provident fund or bank disbursement. HR assumptions above must be checked against company policy.
- Accounts is derived, not double-entry bookkeeping; purchases are treated as paid on the day (no supplier credit yet).
- Sales and purchases use the main godown; branch selling comes later.
- Gemini free-tier daily limits; the AI is a helper and always needs human review.
- Bangla labels should be checked by a native speaker before customer demos.

## Database setup (Supabase SQL Editor, in order)

1. `supabase/01_schema.sql`, `02_security.sql`, `03_functions.sql`
2. Create the two demo logins in Authentication → Users (auto-confirm), then `04_seed.sql`
3. `06_tests.sql` (rule tests + seed checks)
4. Modules: `05_payroll.sql`, `07_modules.sql`, `09_purchase_requests.sql`, `10_hr_extras_godowns.sql`, `11_supervision_feedback.sql` (each ends with its own checks); `08_module_tests.sql`
5. `12_final_checks.sql` — final QA: 22 rule tests + 10 live-data integrity checks (32 / 32 passed on 25 Nov 2026)

QA report with test cases T01–T20 and bugs: [`docs/QA.md`](docs/QA.md)

## Assignment documents

- Part 1 — Product discovery and strategy: *(add link)*
- Part 2 — Architecture, data model, API spec, user stories, AI design note, QA (`docs/QA.md`), sprint plan: *(add links)*
- Part 3 — Metrics and dashboard: *(add link)*
- Part 4: *(add link)*
- Demo video (3–5 min): *(add link)*

## AI usage note

Built with Claude (Anthropic) as a coding assistant, segment by segment from a written spec. The PM wrote the spec and the product decisions, created every account, handled all keys and passwords personally, reviewed each segment, tested on the live site and decided the scope changes (light ERP modules, Salesperson stock receiving without prices, Supervision, Feedback, Shrobon placeholder).
