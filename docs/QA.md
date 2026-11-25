# Oleyn Stock v1 MVP — QA report (Part 2.7)

Live app: https://oleyn-stock.vercel.app · Tested 24–25 Nov 2026.

**How things were tested**

- **DB**: automatic SQL tests run in the Supabase SQL Editor. They act as the real Owner/Salesperson (same login identity the app uses) and are rolled back, so live data is untouched. Files: `supabase/06_tests.sql`, `08`–`11` (each module ends with its own checks) and `supabase/12_final_checks.sql` (final run: **32 / 32 passed** on 25 Nov 2026 — 22 business-rule tests + 10 integrity checks on the live data).
- **API**: `curl` against the live URL.
- **Live UI**: done by hand in the browser/phone. Rows marked **☐ to confirm** need a person to log in and tick them (logins can't be automated by the build assistant).

## 17.1 Test cases

| ID | Area | Scenario | Expected | How checked | Result |
| --- | --- | --- | --- | --- | --- |
| T01 | Roles | Salesperson opens Products | No cost or margin column | DB: Salesperson gets 0 rows from `product_costs`; UI code shows cost only for Owner | Pass (DB) · ☐ confirm on screen |
| T02 | Roles | Salesperson requests `product_costs` directly | Empty result | DB as Salesperson: `product_costs`, `sale_line_costs`, `purchases`, `product_profit` = **0 rows** | **Pass** |
| T03 | Roles | Salesperson opens /payroll | "Your role can't open this page"; no data | DB: `generate_payroll` → `NOT_ALLOWED`; Salesperson sees 0 HR/payroll rows | Pass (DB) · ☐ confirm on screen |
| T04 | Stock | Buy 10, sell 3 | Stock 7; history +10 and −3 with names and times | DB rule test | **Pass** |
| T05 | Stock | Adjust −2 "damaged" with note | Stock 5; reason and note in history | DB rule test | **Pass** |
| T06 | Stock | Cancel an invoice | Stock returns; due drops | DB rule test | **Pass** |
| T07 | Oversell | Salesperson sells 20 with 12 in stock | Blocked: "Only 12 in stock" | DB: `INSUFFICIENT_STOCK:…:12`; UI disables Save and shows the message | **Pass** |
| T08 | Oversell | Owner sells 20 with a reason | Saved; stock −8 shown red; override in history | DB rule test (stock −8, `oversell_override`, note) | **Pass** |
| T09 | Oversell | Two browsers sell the last unit at once | One succeeds, one blocked | By design: `create_sale` locks the product rows (`SELECT … FOR UPDATE`) before checking stock | Design verified · ☐ manual two-phone test |
| T10 | Dues | Credit ৳5,000; pay 2,000 cash + 1,000 bKash | Due ৳2,000; 3 ledger lines with running balance | DB rule test | **Pass** |
| T11 | Dues | Payment larger than due | Refused, due shown | DB: `PAYMENT_EXCEEDS_DUE:2000`; UI blocks and shows "owes only ৳…" | **Pass** |
| T12 | Dues | bKash without transaction ID | "Enter the transaction ID" | DB: `TRX_REF_REQUIRED`; UI requires the field | **Pass** |
| T13 | Safe save | Network off, Save, network on, Retry | One invoice only; draft cleared | DB: same `client_ref` twice → 1 invoice, 2nd returns `duplicate`. UI banner + Retry built | Pass (DB) · ☐ airplane-mode test |
| T14 | AI | Clear printed memo | Review screen filled; nothing saved before confirming | Code: Save disabled until every line has a product and "I checked this memo" is ticked | ☐ run with a real memo photo |
| T15 | AI | AI reads a wrong quantity | Orange "Check this" or maths warning; Owner fixes | Server lowers confidence to ≤0.5 and adds a warning when qty × price ≠ line total by >1% | ☐ run with a real memo photo |
| T16 | AI | Key removed or call over 20 s | Toast; empty manual form; `ai_fallback_used` sent | Server: 20 s `AbortController`; missing key → `ai_failed`; client opens empty form + photo | ☐ airplane-mode / timeout test |
| T17 | API | Correct key and SKU | 200 with stock, no cost | `curl` → 200, `current_stock: 136`, fields: sku, name, unit, current_stock, low_stock, as_of | **Pass** |
| T18 | API | Wrong key | 401 `invalid_api_key` | `curl` → 401 (also: no SKU 400, unknown SKU 404, POST 405, CORS `*`) | **Pass** |
| T19 | Bad input | Quantity 0, negative or letters | Field error; nothing sent | DB: qty 0 and "abc" → `INVALID_QTY`; UI min/number inputs and disabled Save | Pass (DB) · ☐ confirm on screen |
| T20 | Bangla | Switch to বাংলা; search a Bangla product name | Bangla labels; product found; Bangla digits | Live: login page switched to Bangla (Hind Siliguri font). Search matches `name_bn`; numbers use `bn-BD` | Pass (labels) · ☐ Bangla search on Sell |

**Extra checks for modules beyond the spec** (all passed): payroll and raises 8/8 (`08`), Salesperson stock requests 4/4 (`09`), overtime / bonus / godown transfers 5/5 (`10`), Supervision log and feedback 4/4 (`11`).

## Bugs found during the build (real)

| ID | Title | Steps to reproduce | Expected | Actual | Severity | Status and why |
| --- | --- | --- | --- | --- | --- | --- |
| BUG-01 | Salesperson demo login refused | Create `sales@oleyn-demo.com` in Supabase → Add user while a password manager had auto-filled the password box; type the demo password after it; log in with the demo password | Login works | "Email or password is wrong"; `last_sign_in_at` stayed empty (the auto-filled value was saved) | High (blocks required item 9) | **Fixed**: password reset with one SQL update; setup steps now say "clear the box first" |
| BUG-02 | Salesperson could not log out | Log in as Salesperson; look for Log out | A way to log out | Log out existed only in the Owner's More menu | Medium | **Fixed**: Log out on Salesperson home, then a More tab for both roles |
| BUG-03 | Live site build failed after an upload | Upload `App.jsx` that imports new pages while GitHub's web upload of those pages is stuck at "Uploading 2 of 5 files" | Build succeeds | Vercel build **Error** (missing imports); live site stayed on the previous version | High | **Fixed**: re-uploaded; process now waits until every file is uploaded and checks the repo file list before uploading `App.jsx` |
| BUG-04 | Negative due on the Sell screen | Sell with no items; type Paid now 321 | Due ৳0 and a warning | "Due −৳321" (Save was already blocked and the server rejects it) | Low | **Fixed**: due shown as at least ৳0; the warning stays |
| BUG-05 | Analytics silent after adding the PostHog key | Add `VITE_POSTHOG_KEY` in Vercel; use Redeploy from the menu | New build includes the key | No new deployment started; the live bundle had no key, so no events | Medium | **Fixed**: triggered a fresh build by a commit; verified the key is in the bundle and events arrive |
| BUG-06 | Production demo would break the API example | Make the snack-box recipe use Pran Mango, seed 10 boxes | API example stays at 136 | Pran Mango would drop to 116; the seed check caught it | Low | **Fixed before release**: recipe uses Mum water instead |

## Bug report template

```text
ID:            BUG-xx
Title:         short description
Steps:         1. … 2. … 3. …
Expected:      what should happen
Actual:        what happened (with error text)
Severity:      High (blocks a required item or loses data) / Medium (workaround exists) / Low (cosmetic)
Screenshot:    link or file
Status:        Fixed (how) / Shipping with it (why it is acceptable for the MVP)
```
