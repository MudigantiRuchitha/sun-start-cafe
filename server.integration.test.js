const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { createServer: createTcpServer } = require("node:net");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const adminPassword = "integration-test-admin-password";

async function reservePort() {
  const listener = createTcpServer();
  await new Promise((resolve, reject) => {
    listener.listen(0, "127.0.0.1", error => error ? reject(error) : resolve());
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => {
    listener.close(error => error ? reject(error) : resolve());
  });
  return port;
}

async function waitForServer(origin, process) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Server exited with code ${process.exitCode}.`);
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start within six seconds.");
}

test("admin login protects paid orders and fulfillment updates persist", async context => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "sun-star-admin-test-"));
  const dataFile = path.join(tempDirectory, "orders.json");
  const paidOrderId = "SSC1234567890ABCD";
  await writeFile(dataFile, JSON.stringify([
    {
      merchantOrderId: paidOrderId,
      status: "SUCCESS",
      createdAt: "2026-10-01T10:00:00.000Z",
      paidAt: "2026-10-01T10:01:00.000Z",
      orderType: "Pickup",
      customerName: "Test Customer",
      customerPhone: "9876543210",
      customerEmail: "test@example.com",
      address: "",
      notes: "",
      items: [{ id: 1, name: "Hot Coffee", quantity: 1, unitPrice: 40, lineTotal: 40 }],
      totalRupees: 40,
      totalPaise: 4000,
      fulfillmentStatus: "RECEIVED"
    },
    { merchantOrderId: "SSC1234567890PEND", status: "PENDING", customerName: "Unpaid Customer" }
  ]));

  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const serverProcess = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_BASE_URL: origin,
      ADMIN_PASSWORD: adminPassword,
      ORDER_DATA_FILE: dataFile,
      SMTP_HOST: "",
      SMTP_PORT: "",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      SMTP_FROM: "",
      CAFE_NOTIFICATION_EMAIL: ""
    },
    stdio: "ignore"
  });

  context.after(async () => {
    if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
      serverProcess.kill();
      await once(serverProcess, "close");
    }
    await rm(tempDirectory, { recursive: true, force: true });
  });

  await waitForServer(origin, serverProcess);
  assert.equal((await fetch(`${origin}/admin.html`)).status, 200);
  assert.equal((await fetch(`${origin}/admin.css`)).status, 200);
  assert.equal((await fetch(`${origin}/admin.js`)).status, 200);
  assert.equal((await fetch(`${origin}/api/admin/orders`)).status, 401);

  const invalidLogin = await fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "incorrect-password" })
  });
  assert.equal(invalidLogin.status, 401);

  const login = await fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword })
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(";", 1)[0];

  const listResponse = await fetch(`${origin}/api/admin/orders`, { headers: { Cookie: cookie } });
  assert.equal(listResponse.status, 200);
  const { orders } = await listResponse.json();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].merchantOrderId, paidOrderId);
  assert.equal(orders[0].fulfillmentStatus, "RECEIVED");
  assert.equal("totalPaise" in orders[0], false);

  const cashOrderResponse = await fetch(`${origin}/api/cash-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Cash Customer",
      customerPhone: "9876543210",
      customerEmail: "cash@example.com",
      orderType: "Pickup",
      address: "",
      notes: "",
      items: [{ id: 1, quantity: 2, price: 1 }]
    })
  });
  assert.equal(cashOrderResponse.status, 201);
  const cashOrder = await cashOrderResponse.json();
  assert.equal(cashOrder.status, "CASH");
  assert.equal(cashOrder.paymentMethod, "CASH");
  assert.equal(cashOrder.orderType, "Pickup");
  assert.ok(Array.isArray(cashOrder.notifications));
  assert.ok(cashOrder.notifications.some(result => result.status === "not_configured"));
  assert.ok(cashOrder.notifications.every(result => result.channel === "email"));

  const cashUpdate = await fetch(`${origin}/api/admin/orders/${cashOrder.merchantOrderId}`, {
    method: "PATCH",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ fulfillmentStatus: "PREPARING", paymentStatus: "PAID" })
  });
  assert.equal(cashUpdate.status, 200);
  assert.deepEqual(await cashUpdate.json(), { fulfillmentStatus: "PREPARING", paymentStatus: "PAID" });

  const updatedList = await fetch(`${origin}/api/admin/orders`, { headers: { Cookie: cookie } });
  const activeOrders = (await updatedList.json()).orders;
  assert.equal(activeOrders.length, 2);
  const updatedCashOrder = activeOrders.find(order => order.merchantOrderId === cashOrder.merchantOrderId);
  assert.equal(updatedCashOrder.paymentMethod, "CASH");
  assert.equal(updatedCashOrder.paymentStatus, "PAID");
  assert.equal(updatedCashOrder.fulfillmentStatus, "PREPARING");

  const updateResponse = await fetch(`${origin}/api/admin/orders/${paidOrderId}`, {
    method: "PATCH",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ fulfillmentStatus: "PREPARING" })
  });
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(await updateResponse.json(), { fulfillmentStatus: "PREPARING", paymentStatus: "PAID" });
  const persistedOrders = JSON.parse(await readFile(dataFile, "utf8"));
  assert.equal(persistedOrders.find(order => order.merchantOrderId === paidOrderId).fulfillmentStatus, "PREPARING");
  const persistedCash = persistedOrders.find(order => order.merchantOrderId === cashOrder.merchantOrderId);
  assert.equal(persistedCash.paymentStatus, "PAID");
  assert.equal(persistedCash.totalRupees, 80);

  const completeCashOrder = await fetch(`${origin}/api/admin/orders/${cashOrder.merchantOrderId}`, {
    method: "PATCH",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ fulfillmentStatus: "COMPLETED" })
  });
  assert.equal(completeCashOrder.status, 200);
  const completedCash = await completeCashOrder.json();
  assert.ok(Array.isArray(completedCash.notifications));
  assert.ok(completedCash.notifications.some(result => result.status === "not_configured"));
  assert.ok(completedCash.notifications.every(result => result.channel === "email"));

  const retryBeforeDelivered = await fetch(`${origin}/api/admin/orders/${paidOrderId}/notifications`, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ event: "DELIVERED" })
  });
  assert.equal(retryBeforeDelivered.status, 409);

  const logout = await fetch(`${origin}/api/admin/logout`, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie }
  });
  assert.equal(logout.status, 200);
  assert.equal((await fetch(`${origin}/api/admin/orders`, { headers: { Cookie: cookie } })).status, 401);
});
