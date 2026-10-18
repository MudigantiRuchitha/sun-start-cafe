const loginPanel = document.getElementById("loginPanel");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("loginForm");
const loginButton = document.getElementById("loginButton");
const loginMessage = document.getElementById("loginMessage");
const retryConnection = document.getElementById("retryConnection");
const ordersMessage = document.getElementById("ordersMessage");
const ordersList = document.getElementById("ordersList");
const fulfillmentStatuses = ["RECEIVED", "PREPARING", "READY", "COMPLETED"];
const backendUnavailableMessage = "Can't reach the café backend. From the project folder, run `npm start`, then open http://localhost:3000/admin.html. The admin page won't connect when opened as a file or from the static Netlify preview.";
const money = amount => new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
}).format(amount);

async function apiRequest(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
  } catch {
    const error = new Error(backendUnavailableMessage);
    error.name = "BackendUnavailableError";
    throw error;
  }
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error(backendUnavailableMessage);
    error.name = "BackendUnavailableError";
    throw error;
  }
  if (!response.ok) throw new Error(result.error || "The admin request could not be completed.");
  return result;
}

function showDashboard(authenticated) {
  loginPanel.hidden = authenticated;
  dashboard.hidden = !authenticated;
  if (authenticated) loadOrders();
}

function appendText(parent, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderOrder(order) {
  const card = document.createElement("article");
  card.className = "admin-order";

  const heading = document.createElement("div");
  heading.className = "admin-order-heading";
  const title = document.createElement("div");
  appendText(title, "h2", "", `Order ${order.merchantOrderId}`);
  appendText(title, "p", "admin-order-date", `${order.paymentStatus === "PAID" ? "Paid" : "Placed"} ${new Date(order.paidAt || order.createdAt).toLocaleString()}`);
  heading.append(title);
  const badges = document.createElement("div");
  badges.className = "admin-order-badges";
  appendText(badges, "span", "admin-order-meta", order.orderType);
  appendText(
    badges,
    "span",
    `admin-order-meta ${order.paymentStatus === "PAID" ? "admin-payment-paid" : "admin-payment-due"}`,
    order.paymentMethod === "CASH"
      ? (order.paymentStatus === "PAID" ? "Cash received" : "Cash due")
      : "Paid online"
  );
  heading.append(badges);
  card.append(heading);

  const details = document.createElement("div");
  details.className = "admin-order-details";
  appendText(details, "p", "", `${order.customerName} · ${order.customerPhone}`);
  appendText(details, "p", "", order.customerEmail);
  if (order.orderType === "Delivery" && order.address) appendText(details, "p", "", order.address);
  if (order.notes) appendText(details, "p", "", `Notes: ${order.notes}`);
  card.append(details);

  const items = document.createElement("ul");
  items.className = "admin-order-items";
  order.items.forEach(item => {
    const row = document.createElement("li");
    appendText(row, "span", "", `${item.name} × ${item.quantity}`);
    appendText(row, "strong", "", money(item.lineTotal));
    items.append(row);
  });
  card.append(items);

  const notificationHistory = document.createElement("div");
  notificationHistory.className = "admin-notification-history";
  [["PLACED", "Order placed"], ["DELIVERED", "Delivered / picked up"]].forEach(([event, label]) => {
    const state = order.notifications && order.notifications[event];
    const statuses = state
      ? Object.entries(state)
        .filter(([key]) => key.endsWith("Email"))
        .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${value.status.replaceAll("_", " ")}`)
      : [];
    appendText(
      notificationHistory,
      "p",
      "",
      `${label} emails: ${statuses.length ? statuses.join(" · ") : "not sent yet"}`
    );
  });
  card.append(notificationHistory);

  const footer = document.createElement("div");
  footer.className = "admin-order-footer";
  appendText(footer, "strong", "admin-order-total", `Total: ${money(order.totalRupees)}`);
  const form = document.createElement("form");
  form.className = "admin-status-form";
  const label = document.createElement("label");
  const select = document.createElement("select");
  const selectId = `status-${order.merchantOrderId}`;
  label.htmlFor = selectId;
  label.textContent = "Fulfillment";
  select.id = selectId;
  fulfillmentStatuses.forEach(status => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status.charAt(0) + status.slice(1).toLowerCase();
    option.selected = status === order.fulfillmentStatus;
    select.append(option);
  });
  const update = document.createElement("button");
  update.type = "submit";
  update.className = "admin-button admin-button-secondary";
  update.textContent = "Update";
  form.append(label, select);
  let paymentSelect = null;
  if (order.paymentMethod === "CASH") {
    const paymentLabel = document.createElement("label");
    paymentSelect = document.createElement("select");
    paymentLabel.htmlFor = `payment-${order.merchantOrderId}`;
    paymentLabel.textContent = "Cash";
    paymentSelect.id = paymentLabel.htmlFor;
    [
      ["DUE", "Due"],
      ["PAID", "Received"]
    ].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      option.selected = value === order.paymentStatus;
      paymentSelect.append(option);
    });
    form.append(paymentLabel, paymentSelect);
  }
  form.append(update);
  form.addEventListener("submit", event => {
    event.preventDefault();
    updateOrderStatus(order.merchantOrderId, select.value, paymentSelect && paymentSelect.value, update);
  });
  footer.append(form);
  const notificationActions = document.createElement("div");
  notificationActions.className = "admin-notification-actions";
  [
    ["PLACED", "Retry order emails"],
    ["DELIVERED", "Retry delivered / picked-up emails"]
  ].forEach(([event, text]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-button admin-button-secondary";
    button.textContent = text;
    button.disabled = event === "DELIVERED" && order.fulfillmentStatus !== "COMPLETED";
    button.addEventListener("click", () => retryOrderNotification(order.merchantOrderId, event, button));
    notificationActions.append(button);
  });
  footer.append(notificationActions);
  card.append(footer);
  return card;
}

async function loadOrders() {
  ordersMessage.textContent = "Loading orders…";
  ordersList.replaceChildren();
  try {
    const result = await apiRequest("/api/admin/orders", { cache: "no-store" });
    result.orders.forEach(order => ordersList.append(renderOrder(order)));
    ordersMessage.textContent = result.orders.length
      ? `${result.orders.length} ${result.orders.length === 1 ? "order" : "orders"} shown. Cash due is shown separately from online-paid orders.`
      : "No orders yet.";
  } catch (error) {
    ordersMessage.textContent = error.message;
    if (error.message.includes("sign in")) showDashboard(false);
  }
}

async function updateOrderStatus(orderId, fulfillmentStatus, paymentStatus, button) {
  button.disabled = true;
  ordersMessage.textContent = "Updating order…";
  try {
    const result = await apiRequest(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        fulfillmentStatus,
        ...(paymentStatus ? { paymentStatus } : {})
      })
    });
    await loadOrders();
    if (result.notifications) reportNotificationResults(result.notifications);
  } catch (error) {
    ordersMessage.textContent = error.message;
    button.disabled = false;
  }
}

function reportNotificationResults(results) {
  const failed = results.filter(result => result.status === "failed" || result.status === "not_configured");
  if (failed.length) {
    ordersMessage.textContent = `Order status saved, but ${failed.length} email notification(s) need attention: ${failed.map(result => result.message).filter(Boolean).join(" ")}`;
  } else {
    ordersMessage.textContent = "Order status saved and configured email notifications sent.";
  }
}

async function retryOrderNotification(orderId, event, button) {
  button.disabled = true;
  ordersMessage.textContent = "Sending order emails…";
  try {
    const result = await apiRequest(`/api/admin/orders/${encodeURIComponent(orderId)}/notifications`, {
      method: "POST",
      body: JSON.stringify({ event })
    });
    await loadOrders();
    reportNotificationResults(result.notifications);
  } catch (error) {
    ordersMessage.textContent = error.message;
    button.disabled = false;
  }
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginButton.disabled = true;
  loginMessage.textContent = "Signing in…";
  try {
    await apiRequest("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: document.getElementById("adminPassword").value })
    });
    loginForm.reset();
    loginMessage.textContent = "";
    showDashboard(true);
  } catch (error) {
    loginMessage.textContent = error.message;
  } finally {
    loginButton.disabled = false;
  }
});

document.getElementById("refreshOrders").addEventListener("click", loadOrders);
document.getElementById("logoutButton").addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  try {
    await apiRequest("/api/admin/logout", { method: "POST" });
    showDashboard(false);
    loginMessage.textContent = "You have signed out.";
  } catch (error) {
    ordersMessage.textContent = error.message;
  } finally {
    event.currentTarget.disabled = false;
  }
});

async function checkAdminSession() {
  retryConnection.hidden = true;
  loginMessage.textContent = "Connecting to the café backend…";
  try {
    const result = await apiRequest("/api/admin/session", { cache: "no-store" });
    loginMessage.textContent = "";
    showDashboard(result.authenticated);
  } catch (error) {
    loginMessage.textContent = error.message;
    retryConnection.hidden = error.name !== "BackendUnavailableError";
  }
}

retryConnection.addEventListener("click", checkAdminSession);
checkAdminSession();
