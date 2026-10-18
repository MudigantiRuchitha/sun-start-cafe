const assert = require("node:assert/strict");
const test = require("node:test");
const menu = require("./menu-data.js");
const { applyPhonePeStatus, calculateOrder, serializeAdminOrder } = require("./server.js");

function validRequest(overrides = {}) {
  return {
    customerName: "Cafe customer",
    customerPhone: "+91 98765 43210",
    customerEmail: "customer@example.com",
    orderType: "Delivery",
    address: "12 Main Street",
    notes: "",
    items: [{ id: menu[0].id, quantity: 2, price: 1 }],
    ...overrides
  };
}

test("prices orders from the server catalog, not client-supplied prices", () => {
  const order = calculateOrder(validRequest());
  assert.equal(order.totalRupees, menu[0].price * 2);
  assert.equal(order.totalPaise, menu[0].price * 2 * 100);
  assert.equal(order.items[0].unitPrice, menu[0].price);
});

test("rejects invalid and duplicate cart items", () => {
  assert.throws(() => calculateOrder(validRequest({ items: [] })), { status: 400 });
  assert.throws(() => calculateOrder(validRequest({
    items: [{ id: menu[0].id, quantity: 1 }, { id: menu[0].id, quantity: 2 }]
  })), { status: 400 });
  assert.throws(() => calculateOrder(validRequest({ orderType: "Delivery", address: "  " })), { status: 400 });
});

test("sets fulfillment to received only after matching payment is verified", () => {
  const order = { status: "PENDING", totalPaise: 8000 };
  applyPhonePeStatus(order, { state: "COMPLETED", amount: 8000 });
  assert.equal(order.status, "SUCCESS");
  assert.equal(order.fulfillmentStatus, "RECEIVED");
  assert.ok(order.paidAt);
});

test("does not confirm a payment with the wrong amount", () => {
  const order = { status: "PENDING", totalPaise: 8000 };
  assert.throws(() => applyPhonePeStatus(order, { state: "COMPLETED", amount: 1 }), { status: 502 });
  assert.equal(order.status, "PENDING");
});

test("removes customer details after a failed payment", () => {
  const order = {
    status: "PENDING",
    customerName: "Cafe customer",
    customerPhone: "9876543210",
    address: "12 Main Street"
  };
  applyPhonePeStatus(order, { state: "FAILED" });
  assert.equal(order.status, "FAILED");
  assert.equal("customerName" in order, false);
  assert.equal("customerPhone" in order, false);
  assert.equal("address" in order, false);
});

test("admin order serialization excludes payment and internal fields", () => {
  const safeOrder = serializeAdminOrder({
    merchantOrderId: "SSC1234567890",
    status: "SUCCESS",
    phonePeState: "COMPLETED",
    accessToken: "must not be exposed",
    customerName: "Cafe customer",
    fulfillmentStatus: "READY"
  });
  assert.deepEqual(safeOrder, {
    merchantOrderId: "SSC1234567890",
    createdAt: undefined,
    paidAt: undefined,
    orderType: undefined,
    paymentMethod: "PHONEPE",
    paymentStatus: "PAID",
    customerName: "Cafe customer",
    customerPhone: undefined,
    customerEmail: undefined,
    address: undefined,
    notes: undefined,
    items: undefined,
    totalRupees: undefined,
    fulfillmentStatus: "READY",
    notifications: {}
  });
  assert.equal("accessToken" in safeOrder, false);
  assert.equal("phonePeState" in safeOrder, false);
});
