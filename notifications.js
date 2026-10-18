const nodemailer = require("nodemailer");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function orderMessage(order, event) {
  const isDelivered = event === "DELIVERED";
  const completionText = order.orderType === "Pickup" ? "has been picked up" : "has been delivered";
  const itemLines = order.items.map(item =>
    `  ${item.quantity} × ${item.name} — ₹${item.lineTotal}`
  ).join("\n");
  const paymentLabel = order.paymentMethod === "CASH"
    ? (order.paymentStatus === "PAID" ? "Cash received" : "Cash due on delivery / pickup")
    : "Paid online with PhonePe";
  const subject = isDelivered
    ? `${order.orderType === "Pickup" ? "Your pickup is complete" : "Your order has arrived"} | Sun Star Café`
    : `Thanks for ordering from Sun Star Café, ${order.customerName}!`;
  const text = isDelivered
    ? [
      `Hi ${order.customerName},`,
      "",
      order.orderType === "Pickup"
        ? `Your order ${order.merchantOrderId} has been picked up.`
        : `Your order ${order.merchantOrderId} has been delivered.`,
      "We hope you enjoy it. Thank you for choosing Sun Star Café!",
      "",
      `Your order total: ₹${order.totalRupees}`,
      "",
      "Warm regards,",
      "Sun Star Café"
    ].join("\n")
    : [
      `Hi ${order.customerName},`,
      "",
      `We've received your order ${order.merchantOrderId} and it's now confirmed.`,
      order.orderType === "Pickup"
        ? "We'll have it ready for you to collect at the café."
        : "We'll prepare it for delivery to the address you provided.",
      "",
      "YOUR ORDER",
      itemLines,
      "",
      `Total: ₹${order.totalRupees}`,
      `Payment: ${paymentLabel}`,
      "",
      "Thanks for supporting Sun Star Café!",
      "We'll send you another email when your order is complete."
    ].join("\n");
  const html = isDelivered
    ? `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#333">
        <h2>${order.orderType === "Pickup" ? "Thanks for picking up your order!" : "Your order has arrived!"}</h2>
        <p>Hi ${escapeHtml(order.customerName)},</p>
        <p>${order.orderType === "Pickup"
          ? `Order <strong>${escapeHtml(order.merchantOrderId)}</strong> has been picked up.`
          : `Order <strong>${escapeHtml(order.merchantOrderId)}</strong> has been delivered.`}</p>
        <p>We hope you enjoy it. Thank you for choosing Sun Star Café!</p>
        <p>Your order total: <strong>₹${order.totalRupees}</strong></p>
        <p>Warm regards,<br>Sun Star Café</p>
      </div>`
    : `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#333">
        <h2>Thanks for ordering, ${escapeHtml(order.customerName)}!</h2>
        <p>We've received order <strong>${escapeHtml(order.merchantOrderId)}</strong> and it's now confirmed.</p>
        <p>${order.orderType === "Pickup"
          ? "We'll have it ready for you to collect at the café."
          : "We'll prepare it for delivery to the address you provided."}</p>
        <h3>Your order</h3>
        <ul>${order.items.map(item => `<li>${item.quantity} × ${escapeHtml(item.name)} — ₹${item.lineTotal}</li>`).join("")}</ul>
        <p><strong>Total:</strong> ₹${order.totalRupees}<br><strong>Payment:</strong> ${escapeHtml(paymentLabel)}</p>
        <p>Thanks for supporting Sun Star Café! We'll email you again when your order is complete.</p>
      </div>`;
  return { subject, text, html };
}

function cafeOrderMessage(order, event) {
  const completed = event === "DELIVERED";
  const orderItems = order.items.map(item =>
    `${item.name} x ${item.quantity} — ₹${item.lineTotal}`
  );
  const paymentMode = order.paymentMethod === "CASH"
    ? `Cash ${order.orderType === "Delivery" ? "on delivery" : "at pickup"}`
    : "PhonePe online payment";
  const paymentStatus = order.paymentStatus === "PAID"
    ? (order.paymentMethod === "CASH" ? "Cash received" : "Payment confirmed")
    : "Payment due";
  const orderType = order.orderType.toUpperCase();
  const subject = completed
    ? `FULFILLMENT COMPLETE | ${orderType} | ${order.merchantOrderId}`
    : `NEW ORDER RECEIVED — ${orderType} — ${order.merchantOrderId}`;
  const htmlItems = order.items.map(item =>
    `<tr><td style="padding:6px 12px 6px 0">${escapeHtml(item.name)}</td><td style="padding:6px 12px">${item.quantity}</td><td style="padding:6px 0">₹${item.lineTotal}</td></tr>`
  ).join("");
  const detailLines = [
    `Order ID: ${order.merchantOrderId}`,
    `Fulfillment: ${orderType}`,
    `Customer: ${order.customerName}`,
    `Call: ${order.customerPhone}`,
    `Customer email: ${order.customerEmail}`,
    ...(order.orderType === "Delivery" ? [`DELIVER TO: ${order.address}`] : []),
    "",
    "PREPARE:",
    ...orderItems.map(item => `- ${item}`),
    "",
    `Order value: ₹${order.totalRupees}`,
    `Payment mode: ${paymentMode}`,
    `Payment status: ${paymentStatus}`,
    ...(order.notes ? [`CUSTOMER INSTRUCTIONS: ${order.notes}`] : [])
  ];
  const text = completed
    ? [
      "FULFILLMENT UPDATE",
      "This order has been marked complete in the admin system.",
      "",
      ...detailLines,
      "",
      "No further fulfillment action is required."
    ].join("\n")
    : [
      "NEW ORDER RECEIVED — ACTION REQUIRED",
      "A customer order has been received. Review the details below and prepare it.",
      "",
      ...detailLines,
      "",
      "Update the order status in the Sun Star Café admin page when work progresses."
    ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#222">
    <div style="background:#222;color:#fff;padding:16px">
      <h2 style="margin:0">${completed ? "FULFILLMENT COMPLETE" : "NEW ORDER RECEIVED"}</h2>
      <p style="margin:8px 0 0">${escapeHtml(orderType)} · ${escapeHtml(order.merchantOrderId)}</p>
    </div>
    <div style="padding:16px;border:1px solid #ddd">
      ${completed ? "" : "<p>A customer order has been received. Review the details below and prepare it.</p>"}
      <h3>Customer details &amp; handoff</h3>
      <p><strong>Name:</strong> ${escapeHtml(order.customerName)}<br>
      <strong>Phone:</strong> ${escapeHtml(order.customerPhone)}<br>
      <strong>Email:</strong> ${escapeHtml(order.customerEmail)}<br>
      ${order.orderType === "Delivery" ? `<strong>DELIVER TO:</strong> ${escapeHtml(order.address)}` : "<strong>Collection:</strong> Customer pickup at café"}</p>
      <h3>Preparation ticket</h3>
      <table><tbody>${htmlItems}</tbody></table>
      <p><strong>Order value:</strong> ₹${order.totalRupees}<br>
      <strong>Payment mode:</strong> ${escapeHtml(paymentMode)}<br>
      <strong>Payment status:</strong> ${escapeHtml(paymentStatus)}</p>
      ${order.notes ? `<p><strong>Customer instructions:</strong> ${escapeHtml(order.notes)}</p>` : ""}
      <p>${completed
        ? "No further fulfillment action is required."
        : "Update the order status in the Sun Star Café admin page as work progresses."}</p>
    </div>
  </div>`;
  return { subject, text, html };
}

function createNotifier(config = process.env, dependencies = {}) {
  const smtpPort = Number(config.SMTP_PORT || 587);
  const smtpConfigured = Boolean(
    config.SMTP_HOST && Number.isInteger(smtpPort) && smtpPort > 0 && smtpPort <= 65535 &&
    config.SMTP_USER && config.SMTP_PASSWORD && config.SMTP_FROM
  );
  const smtpSecure = config.SMTP_SECURE === "true" || smtpPort === 465;
  const emailTransport = dependencies.emailTransport || (smtpConfigured
    ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: smtpPort,
      secure: smtpSecure,
      requireTLS: !smtpSecure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
    })
    : null);
  async function sendEmail(order, event, recipient, address) {
    if (!smtpConfigured || !emailTransport) {
      return {
        recipient,
        channel: "email",
        status: "not_configured",
        message: "Email delivery is not configured. Set the SMTP settings on the server."
      };
    }
    if (!address) {
      return {
        recipient,
        channel: "email",
        status: "not_configured",
        message: "Set CAFE_NOTIFICATION_EMAIL to receive café email alerts."
      };
    }
    const message = recipient === "cafe"
      ? cafeOrderMessage(order, event)
      : orderMessage(order, event);
    await emailTransport.sendMail({
      from: config.SMTP_FROM,
      to: address,
      subject: message.subject,
      text: message.text,
      html: message.html
    });
    return { recipient, channel: "email", status: "sent" };
  }

  async function notifyOrderEvent(order, event) {
    if (event !== "PLACED" && event !== "DELIVERED") {
      throw new TypeError("Unknown order notification event.");
    }
    const eventState = order.notifications && order.notifications[event]
      ? order.notifications[event]
      : {};
    if (!order.notifications) order.notifications = {};
    order.notifications[event] = eventState;

    return Promise.all([
      { key: "customerEmail", send: () => sendEmail(order, event, "customer", order.customerEmail) },
      { key: "cafeEmail", send: () => sendEmail(order, event, "cafe", config.CAFE_NOTIFICATION_EMAIL) }
    ].map(async target => {
      if (eventState[target.key] && ["sent", "skipped"].includes(eventState[target.key].status)) {
        return {
          recipient: target.key.startsWith("cafe") ? "cafe" : "customer",
          channel: "email",
          ...eventState[target.key]
        };
      }
      const recipient = target.key.startsWith("cafe") ? "cafe" : "customer";
      const channel = "email";
      try {
        const result = await target.send();
        eventState[target.key] = { status: result.status, ...(result.message ? { message: result.message } : {}) };
        if (result.status === "failed") {
          console.error("Order notification failed.", { orderId: order.merchantOrderId, event, recipient, channel, message: result.message });
        }
        return result;
      } catch (error) {
        const result = {
          recipient,
          channel,
          status: "failed",
          message: "The email could not be sent. Check SMTP settings and server logs before retrying."
        };
        eventState[target.key] = { status: result.status, message: result.message };
        console.error("Order notification failed.", {
          orderId: order.merchantOrderId,
          event,
          recipient,
          channel,
          message: error.message
        });
        return result;
      }
    }));
  }

  return { notifyOrderEvent };
}

module.exports = { cafeOrderMessage, createNotifier, orderMessage };
