# GetCarApi

A platform that automatically collects vehicle listings from car marketplaces, builds a permanent history of every vehicle it has ever seen (using the VIN as the unique identifier), and exposes that data through a secure API that your customers can integrate into their own websites.

---

## Table of Contents

1. [What This Platform Does](#1-what-this-platform-does)
2. [The Big Idea: VIN as a Vehicle's Fingerprint](#2-the-big-idea-vin-as-a-vehicles-fingerprint)
3. [How AMS Auto / Encar Collection Works — Step by Step](#3-how-ams-auto--encar-collection-works--step-by-step)
4. [The Admin Dashboard — What Each Section Does](#4-the-admin-dashboard--what-each-section-does)
5. [How to Run Your First Collection Job](#5-how-to-run-your-first-collection-job)
6. [How the Public API Works](#6-how-the-public-api-works)
7. [How API Tokens Work](#7-how-api-tokens-work)
8. [The Database — What Gets Stored and Where](#8-the-database--what-gets-stored-and-where)
9. [Live Feed Providers](#9-live-feed-providers)
10. [Security](#10-security)
11. [Adding a New Provider in the Future](#11-adding-a-new-provider-in-the-future)
12. [Credentials and Environment Variables](#12-credentials-and-environment-variables)
13. [Common Questions](#13-common-questions)

---

## 1. What This Platform Does

Think of this as a **permanent vehicle history recorder**.

Every time a car appears on AMS Auto (or any other source you add later), the platform:
- Saves a snapshot of that listing
- Records when it was seen, how much it cost, how many kilometers it had
- Links it to the car's VIN (the unique 17-character ID stamped on every car)
- **Never deletes old data** — it only adds new observations on top

Over time, a single car (VIN) might appear like this:

| Date | Source | Mileage | Price | Notes |
|------|--------|---------|-------|-------|
| 2019-04-10 | Encar (via AMS Auto) | 72,000 km | $18,000 | First seen |
| 2020-02-14 | Another provider | 84,000 km | $16,500 | Price dropped |
| 2021-08-03 | Copart | 95,000 km | — | Accident listed |
| 2022-11-20 | Encar (via AMS Auto) | 105,000 km | $9,800 | Back on market |

Your customers can then ask your API: *"What is the full history of VIN XYZ?"* and get the entire timeline back.

---

## 2. The Big Idea: VIN as a Vehicle's Fingerprint

A **VIN** (Vehicle Identification Number) is a 17-character code like `KMHD35LE2HA123456`. Every car manufactured after 1981 has one, permanently stamped into the chassis.

This platform uses the VIN as the **primary key** for a vehicle across all sources. Even if BMW uses a different listing ID on AMS Auto vs. Copart, we recognize it is the same car because the VIN matches.

**What happens if a listing has no VIN?**
The listing is still saved and tracked — we just can't link it to a vehicle history. It sits as an "unresolved listing" until a VIN is found.

**VIN normalization rules applied automatically:**
- Converted to uppercase
- Spaces and special characters removed
- Must be exactly 17 characters
- Character at position 9 must be a digit or "X" (this is the VIN check digit)
- Letters I, O, and Q are never valid in a VIN and are rejected

---

## 3. How AMS Auto / Encar Collection Works — Step by Step

The source is: **https://www.amsauto.al/korea/cars**

Even though the website is AMS Auto, we store the data with `provider = "encar"` because that is the underlying Korean source the site aggregates from.

Here is exactly what happens when you trigger a collection job:

### Step 1 — Build the search URL

The system builds a URL with your chosen filters. For example if you pick BMW, 4er, from 2016:

```
https://www.amsauto.al/korea/cars?brand=BMW&model=4er&year_from=2016
```

### Step 2 — Fetch the search results page

The system sends an HTTP request to that URL using a standard browser-like User-Agent header. It does **not** log in, bypass any security, or do anything that violates the site's terms. It reads publicly available pages just like a browser would.

### Step 3 — Find individual listing URLs

Using a tool called **Cheerio** (an HTML parser, like reading the page's source code), it scans for all links that match the pattern `/korea/cars/XXXXXX` — these are individual car listings.

For each link found, it extracts:
- The full URL (e.g. `https://www.amsauto.al/korea/cars/abc12345`)
- A source ID (the last part of the URL: `abc12345`)
- Basic metadata from the card (title, price if visible)

It automatically deduplicates — if the same URL appears twice in the page, it only processes it once.

### Step 4 — Paginate through all results

If there are multiple pages of results, the system automatically follows them (up to the "max pages" limit you configure). It waits a configurable delay (default: 2 seconds) between each page to be respectful to the server.

### Step 5 — Fetch each individual listing

For each listing URL discovered, the system fetches the full listing page. Again: standard HTTP request, no login, no tricks. It retries up to 3 times with exponential backoff if the request fails (waits 1s, then 2s, then 4s).

### Step 6 — Parse the listing page

This is where the data extraction happens. Using Cheerio to read the HTML, the system extracts:

| Field | How it's found |
|-------|---------------|
| Title | `<h1>` tag or page title |
| Price | Any element with "price" in its CSS class, parsed as a number |
| Currency | Currency symbol detected: $=USD, €=EUR, ₩=KRW, £=GBP, ¥=JPY |
| Mileage | Any element with "mileage", "odometer", or "km" in its class |
| Location | Elements with "location", "city", or "region" in their class |
| Make/Brand | From the spec table row labelled "make", "brand", or Russian "марка" |
| Model | From the spec table, row labelled "model" |
| Year | From spec table, or extracted from the title (e.g. "BMW 520d **2019**") |
| Body type | From spec table |
| Fuel type | From spec table (diesel/gasoline/electric/hybrid) |
| Transmission | From spec table (automatic/manual) |
| Drivetrain | From spec table (FWD/RWD/AWD) |
| Engine | From spec table |
| Color | From spec table |
| VIN | Scanned from the **entire page HTML** using a regex pattern for 17-character VINs |
| Photos | Extracted from gallery elements, lazy-load attributes, and swiper slides |

### Step 7 — Save the raw HTML

The **entire raw HTML of the listing page** is saved to the database, along with:
- The URL it came from
- When it was collected
- A SHA-256 hash (fingerprint) of the content

This means: if the HTML has not changed since the last collection, the system skips saving it again. This keeps the database lean.

**Why save raw HTML?** If the parser code improves in the future, you can re-parse old raw HTML with the new parser to extract fields you couldn't extract before — without going back to the website.

### Step 8 — VIN matching

If a VIN was found:
1. The system looks up the VIN in the `vehicles` table
2. If found: update the last-seen date and mileage (if this is more recent data)
3. If not found: create a new vehicle record

### Step 9 — Append an observation (NEVER overwrite)

A new row is written to the `vehicle_observations` table with:
- Which vehicle (VIN)
- Which provider
- The date observed
- Mileage, price, status, location
- A link back to the raw source record

Before inserting, the system computes a **fingerprint hash** from: VIN + provider + source listing ID + price + mileage + status. If an identical observation already exists (same fingerprint), it is skipped — no duplicate rows.

### Step 10 — Save photos

Each photo URL found on the listing page is saved to the `photos` table with:
- The source URL (where the photo lives on AMS Auto)
- The listing it belongs to
- Its position in the gallery
- A hash of the URL (for deduplication)

Note: photos are **not downloaded** at this stage — just the URLs are saved. Downloading can be added later when you have storage set up.

### Step 11 — Report progress

Throughout the job, the system keeps updating the job record with live counters:
- Pages processed
- Listings discovered
- Listings fetched
- VINs found / missing / new / already known
- New observations created
- Duplicate observations skipped
- Errors

---

## 4. The Admin Dashboard — What Each Section Does

Log in at the main URL with your email and password.

### Dashboard
The home page. Shows live summary statistics:
- Total VINs in the database
- Total listings collected
- Total observations recorded
- Number of providers configured
- Jobs running/completed/failed today
- Records collected today and this week
- API requests made

### Vehicles
A searchable, filterable table of all vehicles (VINs) in the database. Click any vehicle to see its full detail page with all collected data.

### VIN Search
Search for a specific VIN. Also supports searching by make, model, year, provider, listing ID, or date range. Displays a chronological timeline for any VIN found.

### Providers
List of all data sources configured in the system. Currently includes:
- **Encar** — AMS Auto Korean used cars (active)
- **Bobaedream** — Korean classifieds (configured, no adapter yet)
- **CarSensor** — Japanese marketplace (disabled)

Click any provider to see its stats and edit its configuration.

### Collectors
The collector configuration page — where you configure how collection jobs behave for each provider (rate limits, delays, max pages, etc.).

### Jobs
All collection jobs — past, present, and queued. Each job shows its status (pending / running / completed / failed / cancelled) and live progress counters. You can cancel a running job from here.

### Live Feeds
Manage live inventory providers (separate from historical collection). These are external APIs that serve real-time vehicle availability to your customers.

### API Clients
Manage the external customers who access your public API. Create a client here first, then create tokens for them.

### API Tokens
Create and revoke API tokens. The raw token is shown **only once** at creation — it is not stored anywhere in the system, only a hashed version is. Your customer must copy it immediately.

### API Logs
A log of every request made to the public API — which client made it, which VIN they requested, whether it succeeded, timestamps.

### Raw Data
Browse the raw HTML records saved for each listing. You can see exactly what the page looked like when it was collected, and which parser version was used.

### Settings
Global platform settings: max parallel collection jobs, whether VIN extraction is enabled, whether raw data retention is on, how many days to keep raw records.

### Audit Logs
A permanent log of every admin action — who created/changed/deleted a provider, who created or revoked a token, who started or stopped a job.

---

## 5. How to Run Your First Collection Job

1. Log into the admin dashboard
2. Go to **Providers** in the left sidebar
3. Click on **Encar**
4. Click **"Create Collection Job"**
5. Fill in the filters:
   - **Brand**: e.g. `BMW`
   - **Model**: e.g. `4er`
   - **Year From**: e.g. `2016`
   - **Max Pages**: start with `3` for a test run
   - **Max Listings**: start with `30` for a test run
   - **Delay between requests**: `2000` ms (2 seconds) is a safe default
6. Click **Start Job**
7. Go to **Jobs** in the sidebar to watch it run

The job will appear as "Running" and the counters will update in real time as listings are collected.

> **Tip:** For your first test, use a small number of pages and listings to verify everything works before running a large collection.

---

## 6. How the Public API Works

Your customers (external websites, developers) access their data through a versioned REST API at `/api/v1/`.

### VIN check — Bearer required, no credit

```
GET /api/v1/vin/check/KMHD35LE2HA123456
Authorization: Bearer vdi_your_token
```

Returns:
```json
{
  "success": true,
  "data": {
    "vin": "KMHD35LE2HA123456",
    "exists": true,
    "providers": ["encar"],
    "hasHistory": true
  }
}
```

This lets authenticated clients check whether you have data for a VIN before paying for the full history. It does **not** expose detailed records and does **not** consume a credit.

### Paid endpoint — Full VIN history (token required)

```
GET /api/v1/vin/KMHD35LE2HA123456
Authorization: Bearer vdi_xxxxxxxxxxxxx
```

Returns the complete vehicle record including all observations, listings, photos, and events in chronological order. This endpoint consumes one credit from the client's allowance.

### Live inventory endpoint (token required)

```
GET /api/v1/live/providers
Authorization: Bearer vdi_xxxxxxxxxxxxx

GET /api/v1/live/vehicles?provider=kbchachacha_live&make=Polestar
Authorization: Bearer vdi_xxxxxxxxxxxxx
```

Returns real-time inventory from an enabled live feed. Pass `provider` to select **Encar** (`encar_live`), **Autowini** (`autowini_live`), or **KB ChaChaCha** (`kbchachacha_live`). If `provider` is omitted, the first enabled feed is used. Supports filtering, sorting, and pagination.

### Error responses

All errors follow the same format:
```json
{
  "success": false,
  "error": {
    "code": "VIN_NOT_FOUND",
    "message": "No data found for this VIN"
  }
}
```

Common error codes: `UNAUTHORIZED`, `TOKEN_EXPIRED`, `RATE_LIMIT_EXCEEDED`, `VIN_NOT_FOUND`, `INVALID_VIN`.

### API documentation

Interactive documentation is available at `/api/docs` — you can browse all endpoints and try them directly in your browser.

---

## 7. How API Tokens Work

**Creating a token:**
1. Go to **API Clients** → Create a new client (give them a name and set their limits)
2. Go to **API Tokens** → Create a token for that client
3. Copy the token immediately — it is shown only once and never stored in plain text

**How tokens are stored:**
The raw token is only ever shown to you once at creation. The system immediately hashes it (using bcrypt) and only stores the hash. This means even if someone gained access to the database, they could not recover the actual tokens.

**Rate limits you can configure per client:**
- Max requests per VIN per period (e.g. a client can only look up the same VIN 3 times per month)
- Daily global limit (e.g. 1,000 VIN requests per day total)
- Monthly global limit

When a limit is exceeded, the API returns HTTP 429 (Too Many Requests) with a clear error message.

**VIN check requires a valid Bearer token and does not consume credits. Retrieve consumes one credit per successful response.**

---

## 8. The Database — What Gets Stored and Where

Here is a plain-language explanation of the main database tables:

| Table | What it stores |
|-------|---------------|
| `vehicles` | One row per unique VIN. The "master record" for a car. |
| `vehicle_observations` | Every time a VIN was seen, a new row is added here. This is the append-only history table. |
| `listings` | One row per listing on a provider site (e.g. one BMW listing on AMS Auto). |
| `raw_source_records` | The full HTML of every fetched page. Stored once per unique content hash. |
| `photos` | Photo URLs extracted from listings. |
| `providers` | The data sources configured in the system (Encar, Copart, etc.). |
| `collection_jobs` | Every collection job that has been created, with its progress and status. |
| `api_clients` | External customers who access the public API. |
| `api_tokens` | Hashed API tokens for each client. |
| `api_request_logs` | A log of every public API request. |
| `admin_users` | Admin accounts for the dashboard. |
| `audit_logs` | A permanent log of every admin action. |
| `settings` | Global platform configuration. |

**The key rule: observations are NEVER deleted or updated.** Every time a vehicle is seen, a new row is appended. The `vehicle_observations` table is the permanent historical record.

---

## 9. Live Feed Providers

This is a separate system from historical collection. While historical collection builds a permanent database over time, **live feeds** are real-time inventory streams.

How it works:
1. A customer calls your API: `GET /api/v1/live/vehicles`
2. Your API calls the configured upstream provider (e.g. an Encar Live API)
3. The response is normalized to your standard schema
4. The normalized data is returned to the customer (they never see the upstream provider's details)
5. The response is **cached in the database** for a configurable TTL (e.g. 30 seconds)

This means if 100 customers all request live vehicles in the same 30-second window, the upstream is only called once — not 100 times.

The upstream provider's API credentials (URL, token) are stored **encrypted** in the database. Even if the database is compromised, the credentials cannot be read without the encryption key.

Currently implemented live adapters: `encar_live`, `autowini_live`, `kbchachacha_live`. Public clients select a feed with `GET /api/v1/live/vehicles?provider=kbchachacha_live`.

---

## 10. Security

| Area | How it's protected |
|------|-------------------|
| Admin login | Email + password. Password is hashed with bcrypt (12 rounds). Sessions stored in the database. |
| Session fixation | Session ID is regenerated on every login. |
| API tokens | Never stored in plain text. Only a bcrypt hash is stored. |
| Database queries | Uses parameterized queries via Drizzle ORM — immune to SQL injection. |
| CSRF | Origin/Referer header checking on all mutating admin requests. |
| Secure headers | Enforced on all API responses. |
| Live provider credentials | Encrypted with AES-256-GCM before storing in the database. |
| SSRF protection | The collector validates every URL it fetches — must match the provider's configured hostname, must use HTTPS, cannot be a private IP address. |
| Rate limiting | Per-client, per-VIN, daily, and monthly limits enforced on the paid API. |
| Audit logging | Every admin action is permanently logged with who did it and when. |

---

## 11. Adding a New Provider in the Future

The platform is designed so adding a new data source (e.g. Copart, IAAI) does not require changing the core database or API.

What you need to do:
1. Create a new adapter class in `artifacts/api-server/src/lib/providers/` that implements the `ProviderAdapter` interface (see `lib/providers/src/example/index.ts` for a fully-commented template)
2. Register it in the adapter factory in `artifacts/api-server/src/lib/collector/worker.ts`
3. Add the provider to the database via the admin dashboard (Providers → Create)

The interface requires these methods:
- `discoverListings(page)` — given a page number, return a list of listing URLs
- `fetchListing(url)` — fetch a single listing page
- `parseListing(fetched)` — extract all fields from the fetched page
- `normalizeVehicle(listing)` — map provider-specific field names to the standard schema
- `extractVIN(listing)` — pull the VIN out of the parsed listing
- `extractPhotos(listing)` — return the list of photo URLs
- `getPagination(fetched)` — determine if there are more pages

Everything else (storing raw data, VIN matching, appending observations, deduplication, photo storage) is handled automatically by the pipeline.

---

## 12. Credentials and Environment Variables

| Variable | What it is |
|----------|-----------|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `SESSION_SECRET` | Secret used to sign admin sessions and encrypt live provider credentials (required) |
| `REDIS_URL` | Not currently used (rate limiting uses PostgreSQL) |

**Rotate `SESSION_SECRET` with care:** changing it will invalidate all admin sessions (everyone gets logged out) and will make stored live provider credentials unreadable (they will need to be re-entered).

---

## 13. Common Questions

**Q: The system collected listings but I don't see any VINs — why?**
A: AMS Auto doesn't always show the VIN prominently on every listing. The system searches the entire HTML for a 17-character VIN pattern, but if the VIN isn't present on the page, the listing is still saved — it just can't be linked to a vehicle history. The listing appears in the Listings section without a VIN.

**Q: How do I know the collection job is working?**
A: Go to Jobs in the sidebar. You will see the job with a "Running" status and live counters updating: pages processed, listings discovered, listings fetched, VINs found.

**Q: Can the system collect data from other websites?**
A: Yes, but each new website requires a new provider adapter to be coded. The platform is designed for this — see section 11 above.

**Q: What happens if the same car appears on AMS Auto again a year later?**
A: A new observation row is added to the history. The old observation is never touched. You end up with two rows in `vehicle_observations` for the same VIN — one from each time it was seen. This is by design.

**Q: Does the system download and store the photos?**
A: Currently only the photo URLs are stored (where they live on AMS Auto). The photos themselves are not downloaded. This can be enabled in a future update when a storage system is configured.

**Q: How do I change the admin password?**
A: Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`, then run:
```bash
pnpm --filter @workspace/scripts run seed-admin
```
If the email already exists, the password is updated. Legacy `admin@localhost` accounts are renamed to `ADMIN_EMAIL` when you change it. There is no password UI yet.

**Q: What is the difference between a Listing and an Observation?**
A: A **Listing** is the page on AMS Auto — one BMW listed for sale. An **Observation** is one moment in time when we saw that listing (with its price, mileage, and status at that moment). If the same listing is collected again next month and the price has dropped, a new Observation is added — the Listing record is updated (last seen date, new price), but the old Observation remains unchanged in history.
