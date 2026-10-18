# Sun Star Cafe

## PhonePe checkout

The Cart page offers PhonePe online payment or cash on delivery / at café pickup. PhonePe Standard Checkout is started on the server and sends the customer to PhonePe's secure hosted checkout. PhonePe returns the customer to the Cart page after the attempt; the page then asks the server to verify the result through PhonePe's order-status API. A browser redirect alone never confirms payment.

Only a PhonePe `COMPLETED` result with an amount matching the server-priced cart confirms online payment. Cash orders are also priced by the server and are recorded as unpaid until staff marks cash as received in the admin page. Order estimates are **30–45 minutes for delivery** or **15–20 minutes for pickup**. `FAILED` means an online-payment order is not placed; `PENDING` remains unconfirmed and can be checked again.

The website confirms online payments only after verification by PhonePe. Order updates are currently email-only; WhatsApp is disabled and SMS has not been configured.

## Café admin and order fulfillment

The Node server provides a private order-management page at `/admin.html`. Sign-in requires an `ADMIN_PASSWORD` environment variable of at least 16 characters. Set a unique password in `.env` locally or in the hosting provider's secret settings; do not put it in frontend files or commit it. The session is held by the server, expires after eight hours, and uses an HttpOnly, SameSite cookie (Secure on HTTPS). Sign-in attempts are rate-limited.

The admin page lists PhonePe-paid and cash orders separately. It displays the customer and fulfillment details, and staff can update each order through **Received**, **Preparing**, **Ready**, and **Completed**. For cash orders, staff can also mark cash as received. These changes are stored with the order. The existing JSON-file order store is suitable only for a single server with persistent storage; configure a persistent disk or migrate to a database before relying on fulfillment data in production.

The static Netlify build does not include the admin page or its backend endpoints. Admin management is available only from the Node server.

## Email order updates

When an order is placed, the server emails the customer and the café. When staff marks fulfillment **Completed**, the server emails a delivered update for delivery orders or a picked-up update for café pickup orders. If SMTP is not configured or an email fails, the order remains placed; the checkout/admin pages show a warning, the admin order lists email status, and staff can use the retry buttons after correcting configuration. WhatsApp is disabled; SMS has not been configured.

Configure the server environment; do not place messaging credentials in browser code or share them in chat:

- **Email:** Set `SMTP_HOST`, `SMTP_PORT` (usually 587), `SMTP_SECURE` (`true` for implicit TLS, otherwise `false`), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `CAFE_NOTIFICATION_EMAIL`. Use the credentials/app password supplied by your email or SMTP provider.
- For Gmail, enable 2-Step Verification and create a Google App Password for the sending account. Use that app password as `SMTP_PASSWORD`; do not use the account's regular login password.

For Render, add each SMTP value in the service's environment settings and redeploy. For local development, put the values in `.env` and restart `npm start`. Once configured, place a test cash order and verify the emails; then mark it **Completed** in the admin page to test the delivered update. PhonePe order-placed emails are sent only after the server verifies payment as completed.

To verify SMTP and send a test email to `CAFE_NOTIFICATION_EMAIL` (or `SMTP_USER` if the café address is unset), run:

```powershell
npm run test:email
```

This command uses Node's built-in `.env` loader; no VS Code extension or separate `dotenv` package is needed. It sends a real email.

### Local sandbox setup

1. Create a PhonePe Payment Gateway merchant account and get the sandbox client ID, client secret, and client version from its merchant dashboard.
2. Use Node.js 22.9 or later. In PowerShell, from this folder, copy `.env.example` to `.env` and set the sandbox credentials:

   ```powershell
   Copy-Item .env.example .env
   ```

   Set `ADMIN_PASSWORD` to a unique secret of at least 16 characters. Keep secrets only in `.env` locally; it is excluded from version control. Never put them in browser code or share them in chat.
3. Start the site:

   ```powershell
   npm start
   ```

4. Open `http://localhost:3000` (not the HTML file directly), add an item, and test using PhonePe sandbox payment methods and test credentials supplied by PhonePe.
5. To open order management, visit `http://localhost:3000/admin.html`. Keep the `npm start` server running in its terminal; the admin page cannot connect when opened as a local HTML file or from the static Netlify preview.

If `.env` is missing, the website server still starts and serves the pages, but checkout explicitly reports which PhonePe credentials need to be configured. Until valid credentials are set, checkout does not create an order.

### Publish a shareable website with Render

The repository includes `render.yaml` to run this Node app as a public Render web service. To publish it, push the **contents of this project folder** to a GitHub repository, then in Render choose **New → Blueprint**, connect that repository, and deploy. Render provides the shareable `https://<service-name>.onrender.com` address after deployment. This workspace has no connected Git remote, so there is no public URL until the project is pushed and deployed through an account you control.

The server binds to `0.0.0.0` by default so Render's web proxy can reach it. After changing deployment settings or code, trigger a Render deploy and check that its `/healthz` health check passes before sharing the service URL.

The initial Render service intentionally has PhonePe credentials unset, so the website can be viewed publicly but checkout reports that it is not configured. After creating your PhonePe sandbox credentials, add `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET`, and `PHONEPE_CLIENT_VERSION` under the Render service's secret environment variables, and set a unique `ADMIN_PASSWORD` of at least 16 characters. Use `PHONEPE_ENV=SANDBOX` while testing.

The free Render service has an ephemeral filesystem and may sleep; it is for previewing the website, not reliable payment/order storage. **Do not enable real payments on this configuration.** Before live transactions, use a persistent database/storage setup, select `PHONEPE_ENV=PRODUCTION`, and verify HTTPS, PhonePe production credentials, merchant settlements, and order operations.

### Publish a static preview with Netlify

This project also includes `netlify.toml` and a static build that excludes the Node server and secrets. To create a public preview quickly:

1. From this folder run `npm run build`; this creates the `dist` folder.
2. Sign in to [Netlify Drop](https://app.netlify.com/drop) and drag the `dist` folder onto the page.
3. Netlify will publish the pages and provide a new public `https://...netlify.app` address. You can rename the site in Netlify's site settings.

The Netlify Drop build is **view-only**: PhonePe checkout, cash-order submission, and order confirmation are unavailable on that static preview. Do not accept orders from it. To enable checkout on Netlify, the payment and order APIs must be ported to Netlify Functions and orders stored in a persistent database; adding merchant credentials to static-site variables is not sufficient.

### Production requirements

- Obtain PhonePe production credentials and set `PHONEPE_ENV=PRODUCTION`.
- Host this Node server at the website's public HTTPS origin and set `APP_BASE_URL` to that exact origin. Configure secrets in the hosting platform's secret manager, not in source code; set `HOST=0.0.0.0` when the host requires binding to its container network.
- Configure the PhonePe merchant account's settlement destination in the PhonePe merchant portal. Gateway payments settle according to that account configuration; entering the café's previous UPI ID in this website does not configure PhonePe payouts.
- Use a persistent writable disk for `data/orders.json`. This starter implementation uses a local JSON file and is intended for one server instance; use a transactional database and appropriate backups before scaling to multiple instances.
- Order records include customer contact and delivery details so the café can fulfill paid orders. Details are removed from failed orders. Restrict server/disk access and establish a retention and deletion policy for successful and still-pending orders before accepting real customer data.
- Payment status is verified on demand using PhonePe's order-status API after the customer returns. Do not treat a return URL, customer report, or frontend-provided status as proof of payment.

The backend uses PhonePe's [website Standard Checkout](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-integration-website), [authorization API](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/authorization), [initiate payment API](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/create-payment/initiate-payment), and [order status API](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/order-status).

## Tests

Run the server validation tests with:

```powershell
npm test
```
