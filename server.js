const { createServer } = require("node:http");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");
const menu = require("./menu-data.js");
const { createNotifier } = require("./notifications.js");

const ROOT = __dirname;
const DATA_FILE = path.resolve(ROOT, process.env.ORDER_DATA_FILE || "data/orders.json");
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const APP_BASE_URL = (
  process.env.APP_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`
).replace(/\/+$/, "");
const PHONEPE_ENV = process.env.PHONEPE_ENV || "SANDBOX";
const PHONEPE_CLIENT_ID = process.env.PHONEPE_CLIENT_ID || "";
const PHONEPE_CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET || "";
const PHONEPE_CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const notifier = createNotifier();
const ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000;
const ADMIN_LOGIN_WINDOW = 15 * 60 * 1000;
const ADMIN_LOGIN_LIMIT = 10;
const adminSessions = new Map();
const adminLoginAttempts = new Map();
const FULFILLMENT_STATUSES = new Set(["RECEIVED", "PREPARING", "READY", "COMPLETED"]);
const PHONEPE_URLS = {
  SANDBOX: {
    auth: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
    api: "https://api-preprod.phonepe.com/apis/pg-sandbox"
  },
  PRODUCTION: {
    auth: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token",
    api: "https://api.phonepe.com/apis/pg"
  }
};

const catalog = new Map(menu.map(item => [item.id, item]));
const orders = new Map();
let writeQueue = Promise.resolve();
let accessToken = null;
let accessTokenExpiresAt = 0;
const createAttempts = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getPhonePeUrls() {
  const urls = PHONEPE_URLS[PHONEPE_ENV];
  if (!urls) throw new HttpError(503, "The payment service is not configured correctly.");
  return urls;
}

function assertPhonePeConfigured() {
  getPhonePeUrls();
  const missing = [
    ["PHONEPE_CLIENT_ID", PHONEPE_CLIENT_ID],
    ["PHONEPE_CLIENT_SECRET", PHONEPE_CLIENT_SECRET],
    ["PHONEPE_CLIENT_VERSION", PHONEPE_CLIENT_VERSION]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new HttpError(503, `PhonePe credentials are missing: ${missing.join(", ")}. Add them to .env from .env.example and restart the server.`);
  }
  let appUrl;
  try {
    appUrl = new URL(APP_BASE_URL);
  } catch {
    throw new HttpError(503, "The café website URL is not configured correctly.");
  }
  if (PHONEPE_ENV === "PRODUCTION" && appUrl.protocol !== "https:") {
    throw new HttpError(503, "Production checkout requires the café website to use HTTPS.");
  }
}

function calculateOrder(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new HttpError(400, "Invalid order details.");
  }
  const { customerName, customerPhone, customerEmail, orderType, address, notes, items } = request;
  if (typeof customerName !== "string" || customerName.trim().length < 1 || customerName.length > 100) {
    throw new HttpError(400, "Enter a valid name.");
  }
  if (typeof customerPhone !== "string" || !/^[0-9+() \x2d]{8,20}$/.test(customerPhone) ||
      customerPhone.replace(/\D/g, "").length < 8 || customerPhone.replace(/\D/g, "").length > 15) {
    throw new HttpError(400, "Enter a valid phone number.");
  }
  if (typeof customerEmail !== "string" || customerEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  if (orderType !== "Delivery" && orderType !== "Pickup") {
    throw new HttpError(400, "Choose delivery or café pickup.");
  }
  if (orderType === "Delivery" && (typeof address !== "string" || !address.trim() || address.length > 500)) {
    throw new HttpError(400, "Enter a delivery address.");
  }
  if (typeof notes !== "string" || notes.length > 300) {
    throw new HttpError(400, "Order notes are too long.");
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > menu.length) {
    throw new HttpError(400, "Your cart is empty or invalid.");
  }

  const seenIds = new Set();
  const pricedItems = items.map(entry => {
    const item = entry && catalog.get(entry.id);
    if (!item || seenIds.has(item.id) || !Number.isInteger(entry.quantity) ||
        entry.quantity < 1 || entry.quantity > 99) {
      throw new HttpError(400, "Your cart contains an invalid item or quantity.");
    }
    seenIds.add(item.id);
    return {
      id: item.id,
      name: item.name,
      quantity: entry.quantity,
      unitPrice: item.price,
      lineTotal: item.price * entry.quantity
    };
  });
  const total = pricedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!Number.isSafeInteger(total * 100) || total * 100 < 100) {
    throw new HttpError(400, "The order total is invalid.");
  }
  return {
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerEmail: customerEmail.trim(),
    orderType,
    address: orderType === "Delivery" ? address.trim() : "",
    notes: notes.trim(),
    items: pricedItems,
    totalRupees: total,
    totalPaise: total * 100
  };
}

function persistOrders() {
  writeQueue = writeQueue.then(async () => {
    await mkdir(path.dirname(DATA_FILE), { recursive: true });
    const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
    await writeFile(temporaryFile, JSON.stringify([...orders.values()], null, 2), { mode: 0o600 });
    await rename(temporaryFile, DATA_FILE);
  });
  return writeQueue;
}

async function loadOrders() {
  try {
    const saved = JSON.parse(await readFile(DATA_FILE, "utf8"));
    if (!Array.isArray(saved)) throw new TypeError("Order storage must contain an array.");
    for (const order of saved) {
      if (order && typeof order.merchantOrderId === "string") {
        orders.set(order.merchantOrderId, order);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function phonePeRequest(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new HttpError(502, "PhonePe did not respond in time. Check the server's internet connection and try again.");
    }
    throw new HttpError(502, "The café server could not connect to PhonePe. Check the server's internet connection and try again.");
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("PhonePe returned an unreadable response.");
  }
  if (!response.ok) {
    console.error("PhonePe API request failed.", {
      status: response.status,
      code: payload.code || payload.errorCode || "unknown"
    });
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, "PhonePe rejected the server credentials. Check that the client ID, secret, version, and SANDBOX or PRODUCTION environment match.");
    }
    throw new Error("PhonePe could not process the payment request.");
  }
  return payload;
}

async function getAccessToken() {
  const now = Date.now();
  if (accessToken && accessTokenExpiresAt > now + 60_000) return accessToken;
  const { auth } = getPhonePeUrls();
  const form = new URLSearchParams({
    client_id: PHONEPE_CLIENT_ID,
    client_version: PHONEPE_CLIENT_VERSION,
    client_secret: PHONEPE_CLIENT_SECRET,
    grant_type: "client_credentials"
  });
  const result = await phonePeRequest(auth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  if (typeof result.access_token !== "string" ||
      (!Number.isFinite(result.expires_at) && !Number.isFinite(result.expires_in))) {
    throw new Error("PhonePe returned an invalid authorization token.");
  }
  accessToken = result.access_token;
  accessTokenExpiresAt = Number.isFinite(result.expires_at)
    ? result.expires_at * 1000
    : now + result.expires_in * 1000;
  return accessToken;
}

async function createPhonePePayment(order) {
  const token = await getAccessToken();
  const { api } = getPhonePeUrls();
  return phonePeRequest(`${api}/checkout/v2/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${token}`
    },
    body: JSON.stringify({
      merchantOrderId: order.merchantOrderId,
      amount: order.totalPaise,
      expireAfter: 1200,
      paymentFlow: {
        type: "PG_CHECKOUT",
        merchantUrls: {
          redirectUrl: `${APP_BASE_URL}/cart.html?merchantOrderId=${encodeURIComponent(order.merchantOrderId)}`
        }
      },
      metaInfo: { udf1: order.orderType }
    })
  });
}

async function fetchPhonePeOrderStatus(order) {
  const token = await getAccessToken();
  const { api } = getPhonePeUrls();
  return phonePeRequest(
    `${api}/checkout/v2/order/${encodeURIComponent(order.merchantOrderId)}/status`,
    {
      headers: {
        Authorization: `O-Bearer ${token}`,
        Accept: "application/json"
      }
    }
  );
}

function publicOrderStatus(order) {
  return {
    status: order.status,
    ...(order.status === "SUCCESS" ? {
      orderReference: order.merchantOrderId,
      orderType: order.orderType
    } : {})
  };
}

function eraseCustomerDetails(order) {
  delete order.customerName;
  delete order.customerPhone;
  delete order.customerEmail;
  delete order.address;
  delete order.notes;
}

function applyPhonePeStatus(order, result) {
  if (result.state === "COMPLETED") {
    if (result.amount !== order.totalPaise) {
      throw new HttpError(502, "Payment amount could not be verified. Contact the café before placing another order.");
    }
    order.status = "SUCCESS";
    order.fulfillmentStatus = order.fulfillmentStatus || "RECEIVED";
    order.paidAt = new Date().toISOString();
  } else if (result.state === "FAILED") {
    order.status = "FAILED";
    eraseCustomerDetails(order);
  } else if (result.state !== "PENDING") {
    throw new HttpError(502, "PhonePe returned an unknown payment status.");
  }
  order.lastStatusCheckAt = Date.now();
  order.phonePeState = result.state;
}

function serializeAdminOrder(order) {
  return {
    merchantOrderId: order.merchantOrderId,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    orderType: order.orderType,
    paymentMethod: order.paymentMethod || "PHONEPE",
    paymentStatus: order.status === "SUCCESS" ? "PAID" : order.paymentStatus,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    address: order.address,
    notes: order.notes,
    items: order.items,
    totalRupees: order.totalRupees,
    fulfillmentStatus: order.fulfillmentStatus || "RECEIVED",
    notifications: order.notifications || {}
  };
}

function notificationResultsForClient(eventState) {
  return Object.entries(eventState || {}).filter(([key]) => key.endsWith("Email")).map(([key, state]) => ({
    recipient: key.startsWith("cafe") ? "cafe" : "customer",
    channel: "email",
    ...state
  }));
}

function requireSameOrigin(request) {
  const origin = request.headers.origin;
  let appOrigin;
  try {
    appOrigin = new URL(APP_BASE_URL).origin;
  } catch {
    throw new HttpError(503, "The café website URL is not configured correctly.");
  }
  if (origin !== appOrigin) throw new HttpError(403, "This request is not allowed.");
}

function getAdminSession(request) {
  const cookieHeader = request.headers.cookie || "";
  const sessionCookie = cookieHeader.split(";").map(value => value.trim())
    .find(value => value.startsWith("sunStarAdminSession="));
  if (!sessionCookie) return null;
  const sessionId = sessionCookie.slice("sunStarAdminSession=".length);
  const session = adminSessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(sessionId);
    return null;
  }
  return { sessionId, session };
}

function requireAdmin(request) {
  const session = getAdminSession(request);
  if (!session) throw new HttpError(401, "Please sign in to the café admin.");
  return session;
}

function allowAdminLogin(request) {
  const now = Date.now();
  const address = request.socket.remoteAddress || "unknown";
  const current = adminLoginAttempts.get(address);
  if (!current || now - current.startedAt >= ADMIN_LOGIN_WINDOW) {
    adminLoginAttempts.set(address, { startedAt: now, count: 1 });
    return;
  }
  if (current.count >= ADMIN_LOGIN_LIMIT) {
    throw new HttpError(429, "Too many sign-in attempts. Please wait 15 minutes and try again.");
  }
  current.count += 1;
}

function isAdminPasswordValid(password) {
  if (ADMIN_PASSWORD.length < 16 || typeof password !== "string" || password.length > 256) return false;
  const supplied = Buffer.from(password);
  const expected = Buffer.from(ADMIN_PASSWORD);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function setAdminCookie(response, sessionId, maxAge) {
  const secure = APP_BASE_URL.startsWith("https://") ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `sunStarAdminSession=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`
  );
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw new HttpError(413, "The order details are too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The order details are not valid JSON.");
  }
}

function allowPaymentAttempt(request) {
  const now = Date.now();
  const address = request.socket.remoteAddress || "unknown";
  const recent = (createAttempts.get(address) || []).filter(timestamp => now - timestamp < 60_000);
  if (recent.length >= 30) throw new HttpError(429, "Too many payment attempts. Please wait a minute and try again.");
  recent.push(now);
  createAttempts.set(address, recent);
}

async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new HttpError(405, "Method not allowed.");
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const allowedFiles = new Set([
    "/index.html", "/menu.html", "/cart.html", "/style.css", "/script.js", "/menu-data.js",
    "/admin.html", "/admin.css", "/admin.js"
  ]);
  if (!allowedFiles.has(requested)) throw new HttpError(404, "Page not found.");
  const filePath = path.join(ROOT, requested.slice(1));
  let contentType = "text/html; charset=utf-8";
  if (requested.endsWith(".css")) contentType = "text/css; charset=utf-8";
  if (requested.endsWith(".js")) contentType = "text/javascript; charset=utf-8";
  const content = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

async function handleRequest(request, response) {
  const url = new URL(request.url, APP_BASE_URL);
  if (url.pathname === "/healthz" && request.method === "GET") {
    return sendJson(response, 200, { status: "ok" });
  }
  if (url.pathname === "/api/payment-health" && request.method === "GET") {
    const missingCredentials = [
      ["PHONEPE_CLIENT_ID", PHONEPE_CLIENT_ID],
      ["PHONEPE_CLIENT_SECRET", PHONEPE_CLIENT_SECRET],
      ["PHONEPE_CLIENT_VERSION", PHONEPE_CLIENT_VERSION]
    ].filter(([, value]) => !value).map(([name]) => name);
    return sendJson(response, 200, {
      server: "available",
      provider: "PhonePe",
      environment: PHONEPE_ENV,
      configured: missingCredentials.length === 0,
      missingCredentials
    });
  }
  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    return sendJson(response, 200, { authenticated: Boolean(getAdminSession(request)) });
  }
  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    requireSameOrigin(request);
    if (ADMIN_PASSWORD.length < 16) {
      throw new HttpError(503, "Admin sign-in is not configured. Set ADMIN_PASSWORD to a secret of at least 16 characters.");
    }
    allowAdminLogin(request);
    const credentials = await readJsonBody(request);
    if (!credentials || !isAdminPasswordValid(credentials.password)) {
      throw new HttpError(401, "Invalid admin password.");
    }
    for (const [sessionId, session] of adminSessions) {
      if (session.expiresAt <= Date.now()) adminSessions.delete(sessionId);
    }
    const sessionId = randomBytes(32).toString("base64url");
    adminSessions.set(sessionId, { expiresAt: Date.now() + ADMIN_SESSION_TTL });
    setAdminCookie(response, sessionId, ADMIN_SESSION_TTL / 1000);
    return sendJson(response, 200, { authenticated: true });
  }
  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    requireSameOrigin(request);
    const session = getAdminSession(request);
    if (session) adminSessions.delete(session.sessionId);
    setAdminCookie(response, "", 0);
    return sendJson(response, 200, { authenticated: false });
  }
  if (url.pathname === "/api/admin/orders" && request.method === "GET") {
    requireAdmin(request);
    const activeOrders = [...orders.values()]
      .filter(order => order.status === "SUCCESS" || order.status === "CASH")
      .sort((a, b) => Date.parse(b.paidAt || b.createdAt) - Date.parse(a.paidAt || a.createdAt))
      .map(serializeAdminOrder);
    return sendJson(response, 200, { orders: activeOrders });
  }
  const adminOrderMatch = url.pathname.match(/^\/api\/admin\/orders\/([A-Za-z0-9_-]{12,63})$/);
  if (adminOrderMatch && request.method === "PATCH") {
    requireSameOrigin(request);
    requireAdmin(request);
    const order = orders.get(adminOrderMatch[1]);
    if (!order || (order.status !== "SUCCESS" && order.status !== "CASH")) {
      throw new HttpError(404, "Order was not found.");
    }
    const update = await readJsonBody(request);
    if (!update || (!FULFILLMENT_STATUSES.has(update.fulfillmentStatus) &&
        !(order.status === "CASH" && (update.paymentStatus === "DUE" || update.paymentStatus === "PAID")))) {
      throw new HttpError(400, "Choose a valid fulfillment or cash payment status.");
    }
    if (update.fulfillmentStatus !== undefined) {
      if (!FULFILLMENT_STATUSES.has(update.fulfillmentStatus)) {
        throw new HttpError(400, "Choose a valid fulfillment status.");
      }
      order.fulfillmentStatus = update.fulfillmentStatus;
    }
    if (update.paymentStatus !== undefined) {
      if (order.status !== "CASH" || (update.paymentStatus !== "DUE" && update.paymentStatus !== "PAID")) {
        throw new HttpError(400, "Cash payment status can only be updated for cash orders.");
      }
      order.paymentStatus = update.paymentStatus;
      if (update.paymentStatus === "PAID") order.paidAt = new Date().toISOString();
      else delete order.paidAt;
    }
    let notifications;
    if (order.fulfillmentStatus === "COMPLETED") {
      notifications = await notifier.notifyOrderEvent(order, "DELIVERED");
    }
    await persistOrders();
    return sendJson(response, 200, {
      fulfillmentStatus: order.fulfillmentStatus || "RECEIVED",
      paymentStatus: order.status === "SUCCESS" ? "PAID" : order.paymentStatus,
      ...(notifications ? { notifications } : {})
    });
  }
  const adminNotificationMatch = url.pathname.match(/^\/api\/admin\/orders\/([A-Za-z0-9_-]{12,63})\/notifications$/);
  if (adminNotificationMatch && request.method === "POST") {
    requireSameOrigin(request);
    requireAdmin(request);
    const order = orders.get(adminNotificationMatch[1]);
    if (!order || (order.status !== "SUCCESS" && order.status !== "CASH")) {
      throw new HttpError(404, "Order was not found.");
    }
    const requestBody = await readJsonBody(request);
    if (!requestBody || (requestBody.event !== "PLACED" && requestBody.event !== "DELIVERED")) {
      throw new HttpError(400, "Choose a valid order notification.");
    }
    if (requestBody.event === "DELIVERED" && order.fulfillmentStatus !== "COMPLETED") {
      throw new HttpError(409, "Mark the order completed before sending its delivered notification.");
    }
    const notifications = await notifier.notifyOrderEvent(order, requestBody.event);
    await persistOrders();
    return sendJson(response, 200, { notifications });
  }
  if (url.pathname === "/api/cash-orders" && request.method === "POST") {
    allowPaymentAttempt(request);
    const orderDetails = calculateOrder(await readJsonBody(request));
    const merchantOrderId = `SSC${Date.now().toString(36).toUpperCase()}${randomBytes(8).toString("hex").toUpperCase()}`;
    const order = {
      ...orderDetails,
      merchantOrderId,
      status: "CASH",
      paymentMethod: "CASH",
      paymentStatus: "DUE",
      fulfillmentStatus: "RECEIVED",
      createdAt: new Date().toISOString()
    };
    orders.set(merchantOrderId, order);
    await persistOrders();
    const notifications = await notifier.notifyOrderEvent(order, "PLACED");
    await persistOrders();
    return sendJson(response, 201, {
      merchantOrderId,
      status: order.status,
      paymentMethod: order.paymentMethod,
      orderType: order.orderType,
      notifications
    });
  }
  if (url.pathname === "/api/payment-orders" && request.method === "POST") {
    assertPhonePeConfigured();
    allowPaymentAttempt(request);
    const orderDetails = calculateOrder(await readJsonBody(request));
    const merchantOrderId = `SSC${Date.now().toString(36).toUpperCase()}${randomBytes(8).toString("hex").toUpperCase()}`;
    const order = {
      ...orderDetails,
      merchantOrderId,
      status: "PENDING",
      paymentMethod: "PHONEPE",
      createdAt: new Date().toISOString(),
      lastStatusCheckAt: 0
    };
    orders.set(merchantOrderId, order);
    await persistOrders();
    let payment;
    try {
      payment = await createPhonePePayment(order);
    } catch (error) {
      order.status = "FAILED";
      eraseCustomerDetails(order);
      await persistOrders();
      throw error;
    }
    let paymentUrl;
    try {
      paymentUrl = new URL(payment.redirectUrl);
    } catch {
      paymentUrl = null;
    }
    if (payment.state !== "PENDING" || !paymentUrl || paymentUrl.protocol !== "https:" ||
        !(paymentUrl.hostname === "phonepe.com" || paymentUrl.hostname.endsWith(".phonepe.com"))) {
      order.status = "FAILED";
      eraseCustomerDetails(order);
      await persistOrders();
      throw new HttpError(502, "PhonePe did not start checkout. No order has been placed.");
    }
    return sendJson(response, 201, {
      merchantOrderId,
      redirectUrl: payment.redirectUrl
    });
  }

  const statusMatch = url.pathname.match(/^\/api\/payment-orders\/([A-Za-z0-9_-]{12,63})\/status$/);
  if (statusMatch && request.method === "GET") {
    assertPhonePeConfigured();
    const order = orders.get(statusMatch[1]);
    if (!order) throw new HttpError(404, "Payment order was not found.");
    if (order.status !== "SUCCESS" && order.status !== "FAILED") {
      if (Date.now() - order.lastStatusCheckAt < 2000) {
        return sendJson(response, 200, publicOrderStatus(order));
      }
      const previousStatus = order.status;
      const result = await fetchPhonePeOrderStatus(order);
      applyPhonePeStatus(order, result);
      await persistOrders();
      if (previousStatus !== "SUCCESS" && order.status === "SUCCESS") {
        await notifier.notifyOrderEvent(order, "PLACED");
        await persistOrders();
      }
    }
    return sendJson(response, 200, {
      ...publicOrderStatus(order),
      ...(order.notifications && order.notifications.PLACED
        ? { notifications: notificationResultsForClient(order.notifications.PLACED) }
        : {})
    });
  }

  if (url.pathname.startsWith("/api/")) throw new HttpError(404, "API endpoint not found.");
  return serveStatic(request, response, url.pathname);
}

async function start() {
  await loadOrders();
  const server = createServer((request, response) => {
    handleRequest(request, response).catch(error => {
      if (!(error instanceof HttpError)) console.error("Request failed.", error);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendJson(response, error.status || 500, {
        error: error.status ? error.message : "The café server encountered an error. Please try again."
      });
    });
  });
  server.listen(PORT, HOST, () => {
    console.log(`Sun Star Café is available at ${APP_BASE_URL}`);
  });
}

if (require.main === module) {
  start().catch(error => {
    console.error("Could not start the café server.", error);
    process.exitCode = 1;
  });
}

module.exports = { applyPhonePeStatus, calculateOrder, publicOrderStatus, serializeAdminOrder };
