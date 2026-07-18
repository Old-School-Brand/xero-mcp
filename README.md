# Xero MCP Server

This is a Model Context Protocol (MCP) server implementation for Xero. It provides a bridge between the MCP protocol and Xero's API, allowing for standardized access to Xero's accounting and business features.

## Features

- Xero OAuth2 Refresh Token authentication
- Read-only by default — write tools (create/update/delete) are opt-in via `XERO_READONLY=false`
- Contacts, accounts, invoices, payments, bank transactions, and reports
- MCP protocol compliance

## Prerequisites

- Node.js (v18 or higher)
- npm
- A Xero developer account with a Web Application and a refresh token

## Docs and Links

- [Xero Public API Documentation](https://developer.xero.com/documentation/api/)
- [Xero API Explorer](https://api-explorer.xero.com/)
- [Xero OpenAPI Specs](https://github.com/XeroAPI/Xero-OpenAPI)
- [Xero-Node Public API SDK Docs](https://xeroapi.github.io/xero-node/accounting)
- [Developer Documentation](https://developer.xero.com/)

## Setup

### Create a Xero Account

If you don't already have a Xero account and organisation already, can create one by signing up [here](https://www.xero.com/au/signup/) using the free trial.

We recommend using a Demo Company to start with because it comes with some pre-loaded sample data. Once you are logged in, switch to it by using the top left-hand dropdown and selecting "Demo Company". You can reset the data on a Demo Company, or change the country, at any time by using the top left-hand dropdown and navigating to [My Xero](https://my.xero.com).

NOTE: To use Payroll-specific queries, the region should be either NZ or UK.

### Authentication

This server uses **Refresh Token** mode. At startup it exchanges a stored refresh token for an access token, persists the rotated refresh token to a local file, and schedules proactive in-process token renewal — so the server stays authenticated indefinitely without any user interaction after the first run.

#### Step 1 — Create a Xero Web Application

1. Go to [https://developer.xero.com/app/manage](https://developer.xero.com/app/manage) and sign in.
2. Click **New app**.
3. Choose **Web app** as the app type.
4. Fill in a name and set the **OAuth 2.0 redirect URI** to `http://localhost:8080/callback`. It is only used during the one-time token acquisition step below, but it must match *exactly* there. Note: `http://localhost` is accepted but `http://127.0.0.1` is **not** — use `localhost`.
5. After saving, open the app → **Configuration** and copy the **Client ID**. Click **Generate a secret** and copy the **Client Secret** immediately (Xero only shows it once). You will need both as env vars.

#### Step 2 — Obtain an initial refresh token

Xero uses the OAuth2 **authorization code** flow. There is no way around a one-time manual bootstrap to mint the first refresh token; the server then keeps it alive automatically thereafter (see [Authentication](#authentication) above). Do this once with `curl` — you'll need a terminal with `curl` and `jq`, and your app's Client ID / Client Secret exported once:

```bash
export CLIENT_ID="<your app client id>"
export CLIENT_SECRET="<your app client secret>"
```

**1. Get an authorization code.** Open this URL in a browser (replace `<CLIENT_ID>`). It sends you through Xero's login + org-consent screen. The `scope` value here is the **read-only** granular set this server needs by default — see [Required Scopes](#required-scopes) below for the mapping and for the extra write scopes if you enable write tools.

```
https://login.xero.com/identity/connect/authorize?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid%20profile%20email%20offline_access%20accounting.contacts.read%20accounting.settings.read%20accounting.invoices.read%20accounting.payments.read%20accounting.banktransactions.read%20accounting.manualjournals.read%20accounting.reports.profitandloss.read%20accounting.reports.balancesheet.read%20accounting.reports.trialbalance.read%20payroll.employees.read%20payroll.timesheets.read%20payroll.settings.read&state=xero-mcp-bootstrap
```

After you approve, Xero redirects to `http://localhost:8080/callback?code=...&state=xero-mcp-bootstrap`. Nothing is listening on port 8080, so the browser shows a connection error — **that's expected**. Copy the `code` value straight out of the address bar. The code is **single-use and expires after 5 minutes**, so move on promptly.

```bash
export CODE="<the code from the redirect URL>"
```

**2. Exchange the code for tokens:**

```bash
curl -sX POST https://identity.xero.com/connect/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=authorization_code&code=$CODE&redirect_uri=http://localhost:8080/callback" \
  | jq
```

The response contains the `refresh_token` you need — this is your `XERO_REFRESH_TOKEN`:

```json
{
  "access_token": "...",   // valid 30 minutes
  "refresh_token": "...",  // valid 60 days, rotates on every refresh — this is what the server stores
  "expires_in": 1800,
  "token_type": "Bearer",
  "id_token": "..."
}
```

#### Step 3 — Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```
XERO_CLIENT_ID=your_client_id_here
XERO_CLIENT_SECRET=your_client_secret_here
XERO_REFRESH_TOKEN=your_refresh_token_here
```

The server will write the rotated refresh token to `~/.xero-mcp/refresh_token` after first startup. Subsequent starts use the file-stored token automatically, so you only need `XERO_REFRESH_TOKEN` set for the first run (or after a manual token rotation).

To use a custom token file location, set `XERO_TOKEN_FILE=/path/to/refresh_token`.

> **Note:** Make sure the directory containing your token file exists before starting the server. The server will create the file but not the directory.

#### Required Scopes

Request the scopes that match the Xero APIs you intend to use. `offline_access` is what makes Xero return a `refresh_token` at all — without it the connection cannot be maintained.

> **Use granular scopes, not the broad ones.** Xero is retiring the broad scopes (`accounting.transactions`, `accounting.reports.read`, etc.). **Apps created on or after 2 March 2026 can only request the granular scopes** (apps created before then keep the broad scopes until September 2027). Since any app you create now is granular-only, the broad scopes will not be selectable — use the granular set below. This is the most likely reason an older token-bootstrap flow fails.

This server runs **read-only by default** ([Tool exposure](#tool-exposure) below), so mint a **read-only-scoped** token unless you have explicitly enabled write tools. The granular read scopes below match the read tools (`list-*`, `get-*`):

```
openid profile email
offline_access

accounting.contacts.read             # contacts, contact groups
accounting.settings.read             # accounts, items, tax rates, tracking categories, organisation
accounting.invoices.read             # invoices, credit notes, quotes
accounting.payments.read             # payments
accounting.banktransactions.read     # bank transactions
accounting.manualjournals.read       # manual journals
accounting.journals.read             # general ledger (list-account-transactions)

accounting.reports.profitandloss.read
accounting.reports.balancesheet.read
accounting.reports.trialbalance.read

payroll.employees.read               # payroll employees, leave
payroll.timesheets.read              # timesheets
payroll.settings.read                # payroll leave types
```

**If you enable write tools** (`XERO_READONLY=false`), swap the read/write variants — the same scope strings without the `.read` suffix grant write access too: `accounting.contacts`, `accounting.settings`, `accounting.invoices`, `accounting.payments`, `accounting.banktransactions`, `accounting.manualjournals`, and `payroll.timesheets`. Reports are read-only regardless.

> The aged receivables/payables reports also require a reports scope. The exact granular scopes available to *your* app are listed on its **Configuration → Authorisation** page in the developer portal — request every one there that matches the tools you'll use. See the [Xero OAuth 2.0 Scopes documentation](https://developer.xero.com/documentation/guides/oauth2/scopes/) and [Granular Scopes FAQs](https://developer.xero.com/faq/granular-scopes) for the full reference.

#### Integrating the MCP server with Claude Desktop

To add the MCP server to Claude go to Settings > Developer > Edit config and add the following to your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "xero": {
      "command": "npx",
      "args": ["-y", "@xeroapi/xero-mcp-server@latest"],
      "env": {
        "XERO_CLIENT_ID": "your_client_id_here",
        "XERO_CLIENT_SECRET": "your_client_secret_here",
        "XERO_REFRESH_TOKEN": "your_refresh_token_here"
      }
    }
  }
}
```

After first startup, the server writes the rotated refresh token to `~/.xero-mcp/refresh_token`. On subsequent starts `XERO_REFRESH_TOKEN` in the config is ignored in favour of the file-stored token, so you do not need to update the config after each token rotation.

NOTE: If you are using [Node Version Manager](https://github.com/nvm-sh/nvm) `"command": "npx"` section change it to be the full path to the executable, ie: `your_home_directory/.nvm/versions/node/v22.14.0/bin/npx` on Mac / Linux or `"your_home_directory\\.nvm\\versions\\node\\v22.14.0\\bin\\npx"` on Windows

### Available MCP Commands

#### Tool exposure

The server runs **read-only by default** — only the read tools below are registered and advertised. To also expose the write tools, set `XERO_READONLY=false`. Pair the choice with the matching token scopes (see [Required Scopes](#required-scopes)): a read-only deployment should use a read-only-scoped refresh token so least privilege is enforced at Xero, not just in this server.

#### Read tools (available by default)

- `list-accounts`: Retrieve a list of accounts
- `list-contacts`: Retrieve a list of contacts from Xero
- `list-credit-notes`: Retrieve a list of credit notes
- `list-invoices`: Retrieve a list of invoices
- `list-items`: Retrieve a list of items
- `list-manual-journals`: Retrieve a list of manual journals
- `list-account-transactions`: Retrieve general-ledger lines for one account (Xero Journals feed, paginated by offset)
- `list-organisation-details`: Retrieve details about an organisation
- `list-profit-and-loss`: Retrieve a profit and loss report
- `list-quotes`: Retrieve a list of quotes
- `list-tax-rates`: Retrieve a list of tax rates
- `list-payments`: Retrieve a list of payments
- `list-trial-balance`: Retrieve a trial balance report
- `list-bank-transactions`: Retrieve a list of bank account transactions
- `list-payroll-employees`: Retrieve a list of Payroll Employees
- `list-report-balance-sheet`: Retrieve a balance sheet report
- `list-payroll-employee-leave`: Retrieve a Payroll Employee's leave records
- `list-payroll-employee-leave-balances`: Retrieve a Payroll Employee's leave balances
- `list-payroll-employee-leave-types`: Retrieve a list of Payroll leave types
- `list-payroll-leave-periods`: Retrieve a list of a Payroll Employee's leave periods
- `list-payroll-leave-types`: Retrieve a list of all available leave types in Xero Payroll
- `list-timesheets`: Retrieve a list of Payroll Timesheets
- `list-aged-receivables-by-contact`: Retrieves aged receivables for a contact
- `list-aged-payables-by-contact`: Retrieves aged payables for a contact
- `list-contact-groups`: Retrieve a list of contact groups
- `list-tracking-categories`: Retrieve a list of tracking categories
- `get-payroll-timesheet`: Retrieve an existing Payroll Timesheet

#### Write tools (require `XERO_READONLY=false`)

- `create-bank-transaction`: Create a new bank transaction
- `create-contact`: Create a new contact
- `create-credit-note`: Create a new credit note
- `create-invoice`: Create a new invoice
- `create-item`: Create a new item
- `create-manual-journal`: Create a new manual journal
- `create-payment`: Create a new payment
- `create-quote`: Create a new quote
- `create-payroll-timesheet`: Create a new Payroll Timesheet
- `create-tracking-category`: Create a new tracking category
- `create-tracking-option`: Create a new tracking option
- `update-bank-transaction`: Update an existing bank transaction
- `update-contact`: Update an existing contact
- `update-invoice`: Update an existing draft invoice
- `update-item`: Update an existing item
- `update-manual-journal`: Update an existing manual journal
- `update-quote`: Update an existing draft quote
- `update-credit-note`: Update an existing draft credit note
- `update-tracking-category`: Update an existing tracking category
- `update-tracking-options`: Update tracking options
- `update-payroll-timesheet-line`: Update a line on an existing Payroll Timesheet
- `approve-payroll-timesheet`: Approve a Payroll Timesheet
- `revert-payroll-timesheet`: Revert an approved Payroll Timesheet
- `add-payroll-timesheet-line`: Add new line on an existing Payroll Timesheet
- `delete-payroll-timesheet`: Delete an existing Payroll Timesheet

For detailed API documentation, please refer to the [MCP Protocol Specification](https://modelcontextprotocol.io/).

## For Developers

### Installation

```bash
npm install
```

### Run a build

```bash
npm run build
```

### Integrating with Claude Desktop

To link your Xero MCP server in development to Claude Desktop go to Settings > Developer > Edit config and add the following to your `claude_desktop_config.json` file:

NOTE: For Windows ensure the `args` path escapes the `\` between folders ie. `"C:\\projects\xero-mcp-server\\dist\\index.js"`

```json
{
  "mcpServers": {
    "xero": {
      "command": "node",
      "args": ["insert-your-file-path-here/xero-mcp-server/dist/index.js"],
      "env": {
        "XERO_CLIENT_ID": "your_client_id_here",
        "XERO_CLIENT_SECRET": "your_client_secret_here",
        "XERO_REFRESH_TOKEN": "your_refresh_token_here"
      }
    }
  }
}
```

## License

MIT

## Security

Please do not commit your `.env` file or any sensitive credentials to version control (it is included in `.gitignore` as a safe default.)
