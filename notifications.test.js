const assert = require("node:assert/strict");
const test = require("node:test");
const { cafeOrderMessage, createNotifier, orderMessage } = require("./notifications.js");

const baseOrder = {
  customerName: "<Cafe customer>",
  customerPhone: "+91 98765 43210",
  customerEmail: "customer@example.com",
  orderType: "Delivery",
  address: "12 Main Street",
  items: [{ name: "Hot Coffee", quantity: 2, lineTotal: 80 }],
  totalRupees: 80,
  paymentMethod: "CASH",
  paymentStatus: "DUE",
  merchantOrderId: "SSC1234567890"
};

function createOrder(overrides = {}) {
  return { ...baseOrder, ...overrides };
}

function configuredNotifier(emailTransport) {
  return createNotifier({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "cafe@example.com",
    SMTP_PASSWORD: "test-password",
    SMTP_FROM: "Sun Star <cafe@example.com>",
    CAFE_NOTIFICATION_EMAIL: "owner@example.com"
  }, { emailTransport });
}

test("sends order placed and delivered emails to customer and café", async () => {
  const emails = [];
  const notifier = configuredNotifier({
    sendMail: async message => emails.push(message)
  });
  const order = createOrder();

  const placed = await notifier.notifyOrderEvent(order, "PLACED");
  assert.equal(placed.length, 2);
  assert.ok(placed.every(result => result.status === "sent" && result.channel === "email"));
  assert.equal(emails.length, 2);
  const customerPlacedEmail = emails.find(email => email.to === "customer@example.com");
  const cafePlacedEmail = emails.find(email => email.to === "owner@example.com");
  assert.match(customerPlacedEmail.text, /Hi <Cafe customer>/);
  assert.match(customerPlacedEmail.text, /it's now confirmed/);
  assert.match(customerPlacedEmail.text, /Thanks for supporting Sun Star Café/);
  assert.match(customerPlacedEmail.html, /&lt;Cafe customer&gt;/);
  assert.match(customerPlacedEmail.html, /Thanks for ordering/);
  assert.match(cafePlacedEmail.subject, /NEW ORDER RECEIVED — DELIVERY/);
  assert.match(cafePlacedEmail.text, /NEW ORDER RECEIVED — ACTION REQUIRED/);
  assert.match(cafePlacedEmail.text, /Customer: <Cafe customer>/);
  assert.match(cafePlacedEmail.text, /Call: \+91 98765 43210/);
  assert.match(cafePlacedEmail.text, /Customer email: customer@example.com/);
  assert.match(cafePlacedEmail.text, /DELIVER TO: 12 Main Street/);
  assert.match(cafePlacedEmail.text, /Payment mode: Cash on delivery/);
  assert.match(cafePlacedEmail.text, /Payment status: Payment due/);
  assert.match(cafePlacedEmail.text, /Update the order status/);
  assert.match(cafePlacedEmail.html, /PREPARATION TICKET/i);
  assert.match(cafePlacedEmail.html, /Payment mode:<\/strong> Cash on delivery/);
  assert.doesNotMatch(cafePlacedEmail.text, /Thanks for supporting/);
  assert.doesNotMatch(cafePlacedEmail.text, /Hi <Cafe customer>/);
  assert.notEqual(cafePlacedEmail.subject, customerPlacedEmail.subject);
  assert.notEqual(cafePlacedEmail.text, customerPlacedEmail.text);
  assert.equal(order.notifications.PLACED.customerEmail.status, "sent");

  const delivered = await notifier.notifyOrderEvent(order, "DELIVERED");
  assert.equal(delivered.length, 2);
  assert.ok(delivered.every(result => result.status === "sent" && result.channel === "email"));
  assert.equal(emails.length, 4);
  const customerDeliveredEmail = emails.find(email =>
    email.to === "customer@example.com" && email.subject.includes("arrived")
  );
  const cafeDeliveredEmail = emails.find(email =>
    email.to === "owner@example.com" && email.subject.includes("FULFILLMENT COMPLETE")
  );
  assert.ok(customerDeliveredEmail);
  assert.ok(cafeDeliveredEmail);
  assert.match(customerDeliveredEmail.text, /has been delivered/);
  assert.match(customerDeliveredEmail.text, /We hope you enjoy it/);
  assert.match(cafeDeliveredEmail.text, /No further fulfillment action is required/);
  assert.doesNotMatch(cafeDeliveredEmail.text, /We hope you enjoy it/);
  assert.equal(order.notifications.DELIVERED.cafeEmail.status, "sent");
});

test("reports missing SMTP configuration without sending a message", async () => {
  const notifier = createNotifier({
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASSWORD: ""
  });
  const results = await notifier.notifyOrderEvent(createOrder(), "PLACED");
  assert.equal(results.length, 2);
  assert.ok(results.every(result => result.channel === "email" && result.status === "not_configured"));
});

test("retries failed email sends and reports recipient-specific configuration gaps", async () => {
  let attempts = 0;
  const notifier = createNotifier({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "cafe@example.com",
    SMTP_PASSWORD: "test-password",
    SMTP_FROM: "cafe@example.com"
  }, {
    emailTransport: { sendMail: async () => { attempts += 1; throw new Error("SMTP unavailable"); } }
  });
  const order = createOrder();

  const first = await notifier.notifyOrderEvent(order, "PLACED");
  assert.equal(first.filter(result => result.status === "failed").length, 1);
  assert.equal(first.filter(result => result.status === "not_configured").length, 1);
  const retried = await notifier.notifyOrderEvent(order, "PLACED");
  assert.equal(retried.filter(result => result.status === "failed").length, 1);
  assert.equal(attempts, 2);
});

test("uses pickup-specific completion wording and escapes customer content", () => {
  const message = orderMessage(createOrder({ orderType: "Pickup" }), "DELIVERED");
  assert.match(message.subject, /Your pickup is complete/);
  assert.match(message.text, /has been picked up/);
  assert.doesNotMatch(message.text, /has been delivered/);
  assert.match(message.html, /&lt;Cafe customer&gt;/);
});

test("café email includes operational order details and pickup completion", () => {
  const order = createOrder({
    customerPhone: "+91 98765 43210",
    customerEmail: "customer@example.com",
    address: "12 Main Street <unit 4>",
    notes: "Leave at counter & call",
    orderType: "Delivery"
  });
  const placed = cafeOrderMessage(order, "PLACED");
  assert.match(placed.subject, /NEW ORDER RECEIVED — DELIVERY/);
  assert.match(placed.text, /DELIVER TO: 12 Main Street <unit 4>/);
  assert.match(placed.text, /CUSTOMER INSTRUCTIONS: Leave at counter & call/);
  assert.match(placed.html, /12 Main Street &lt;unit 4&gt;/);
  assert.match(placed.html, /Leave at counter &amp; call/);

  const onlinePayment = cafeOrderMessage({
    ...order,
    paymentMethod: "PHONEPE",
    paymentStatus: "PAID"
  }, "PLACED");
  assert.match(onlinePayment.text, /Payment mode: PhonePe online payment/);
  assert.match(onlinePayment.text, /Payment status: Payment confirmed/);

  const pickup = cafeOrderMessage({ ...order, orderType: "Pickup" }, "DELIVERED");
  assert.match(pickup.subject, /FULFILLMENT COMPLETE/);
  assert.doesNotMatch(pickup.text, /DELIVER TO:/);
});
