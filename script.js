const CART_STORAGE_KEY = "sunStarCafeCart";
const CUSTOMER_STORAGE_KEY = "sunStarCafeCustomer";

const menu = globalThis.SUN_STAR_MENU;
const categories = ["All", "Drinks", "Snacks", "Puffs", "Meals"];
const money = amount => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
const menuItems = document.getElementById("menuItems");
const categoryFilters = document.getElementById("categoryFilters");
const cartItems = document.getElementById("cartItems");
const cartCount = document.getElementById("cartCount");
const menuCartSummary = document.getElementById("menuCartSummary");
const menuCartCount = document.getElementById("menuCartCount");
const menuCartTotal = document.getElementById("menuCartTotal");
const menuCartLink = document.getElementById("menuCartLink");
const cartSubtotal = document.getElementById("cartSubtotal");
const cartTotal = document.getElementById("cartTotal");
const deliveryFee = document.getElementById("deliveryFee");
const orderForm = document.getElementById("orderForm");
const orderStatus = document.getElementById("orderStatus");
const rememberDetails = document.getElementById("rememberDetails");
const cartAddStatus = document.getElementById("cartAddStatus");
const paymentPanel = document.getElementById("paymentPanel");
const paymentVerificationStatus = document.getElementById("paymentVerificationStatus");
const paymentStatusDescription = document.getElementById("paymentStatusDescription");
const orderConfirmation = document.getElementById("orderConfirmation");
const confirmedOrderReference = document.getElementById("confirmedOrderReference");
const deliveryEstimate = document.getElementById("deliveryEstimate");
const retryPaymentStatus = document.getElementById("retryPaymentStatus");
const submitOrderButton = document.getElementById("submitOrderButton");
const paymentMethod = document.getElementById("paymentMethod");
const paymentMethodNote = document.getElementById("paymentMethodNote");
let activePaymentOrderId = null;
let paymentStatusTimer = null;
let activeCategory = "All";

function loadCart() {
  const cart = new Map();
  try {
    const saved = localStorage.getItem(CART_STORAGE_KEY);
    if (!saved) return cart;
    const entries = JSON.parse(saved);
    if (!Array.isArray(entries)) throw new TypeError("Saved cart must be an array.");
    entries.forEach(entry => {
      const [id, quantity] = entry;
      const validId = menu.some(item => item.id === id);
      if (validId && Number.isInteger(quantity) && quantity > 0 && quantity <= 99) cart.set(id, quantity);
    });
  } catch (error) {
    console.error("Could not load the saved cart. Starting with an empty cart.", error);
  }
  return cart;
}

const cart = loadCart();

function loadCustomerDetails() {
  try {
    const saved = localStorage.getItem(CUSTOMER_STORAGE_KEY);
    if (!saved) return null;
    const details = JSON.parse(saved);
    if (!details || typeof details !== "object") throw new TypeError("Saved customer details are invalid.");
    return details;
  } catch (error) {
    console.error("Could not load saved customer details.", error);
    return null;
  }
}

function fillCustomerDetails() {
  if (!orderForm) return;
  const details = loadCustomerDetails();
  if (!details) return;
  ["customerName", "customerPhone", "customerEmail", "customerAddress"].forEach(id => {
    const field = document.getElementById(id);
    if (typeof details[id] === "string") field.value = details[id];
  });
  if (details.orderType === "Pickup" || details.orderType === "Delivery") {
    orderType.value = details.orderType;
    orderType.dispatchEvent(new Event("change"));
  }
  rememberDetails.checked = true;
}

function saveCustomerDetails() {
  if (!rememberDetails || !rememberDetails.checked) {
    try {
      localStorage.removeItem(CUSTOMER_STORAGE_KEY);
      return true;
    } catch (error) {
      console.error("Could not remove saved customer details from this browser.", error);
      return false;
    }
  }
  const details = {
    customerName: document.getElementById("customerName").value.trim(),
    customerPhone: document.getElementById("customerPhone").value.trim(),
    customerEmail: document.getElementById("customerEmail").value.trim(),
    customerAddress: orderType.value === "Delivery" ? document.getElementById("customerAddress").value.trim() : "",
    orderType: orderType.value
  };
  try {
    localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(details));
    return true;
  } catch (error) {
    console.error("Could not save customer details in this browser.", error);
    return false;
  }
}

function createPaymentRequest() {
  return {
    customerName: document.getElementById("customerName").value.trim(),
    customerPhone: document.getElementById("customerPhone").value.trim(),
    customerEmail: document.getElementById("customerEmail").value.trim(),
    orderType: orderType.value,
    address: orderType.value === "Delivery" ? document.getElementById("customerAddress").value.trim() : "",
    notes: document.getElementById("orderNotes").value.trim(),
    items: [...cart.entries()].map(([id, quantity]) => ({ id, quantity }))
  };
}

function saveCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([...cart.entries()]));
  } catch (error) {
    console.error("Could not save the cart in this browser.", error);
  }
}

function renderFilters() {
  if (!categoryFilters) return;
  categoryFilters.replaceChildren();
  categories.forEach(category => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-button" + (activeCategory === category ? " active" : "");
    button.textContent = category;
    button.setAttribute("aria-pressed", String(activeCategory === category));
    button.addEventListener("click", () => { activeCategory = category; renderFilters(); renderMenu(); });
    categoryFilters.append(button);
  });
}

function renderMenu() {
  if (!menuItems) return;
  menuItems.replaceChildren();
  const filtered = activeCategory === "All" ? menu : menu.filter(item => item.category === activeCategory);
  filtered.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "food-card";
    card.style.setProperty("--card-index", index);
    const imageWrap = document.createElement("div"); imageWrap.className = "food-image-wrap";
    const img = document.createElement("img"); img.src = item.image; img.alt = item.name; img.loading = "lazy";
    img.onerror = () => { img.alt = item.name + " image unavailable"; img.removeAttribute("src"); imageWrap.style.minHeight = "120px"; };
    const category = document.createElement("span"); category.className = "food-category"; category.textContent = item.category;
    imageWrap.append(img, category);
    if (item.imageCredit && item.imageCreditUrl) {
      const credit = document.createElement("a");
      credit.className = "image-credit";
      credit.href = item.imageCreditUrl;
      credit.target = "_blank";
      credit.rel = "noopener noreferrer";
      credit.textContent = item.imageCredit;
      imageWrap.append(credit);
    }
    const info = document.createElement("div"); info.className = "food-info";
    const title = document.createElement("h2"); title.textContent = item.name;
    const desc = document.createElement("p"); desc.textContent = item.desc;
    const bottom = document.createElement("div"); bottom.className = "food-bottom";
    const price = document.createElement("span"); price.className = "price"; price.textContent = money(item.price);
    const quantityControl = document.createElement("div");
    quantityControl.className = "menu-quantity-control";
    const updateQuantity = quantity => {
      if (quantity <= 0) cart.delete(item.id);
      else cart.set(item.id, Math.min(quantity, 99));
      saveCart();
      renderCart();
      if (cartAddStatus) cartAddStatus.textContent = quantity <= 0
        ? `${item.name} removed from your cart.`
        : `${item.name} quantity: ${Math.min(quantity, 99)}.`;
      renderQuantityControl();
    };
    const renderQuantityControl = () => {
      quantityControl.replaceChildren();
      const quantity = cart.get(item.id) || 0;
      if (quantity === 0) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "add-button";
        add.textContent = "+ Add to cart";
        add.setAttribute("aria-label", `Add ${item.name} to cart`);
        add.addEventListener("click", () => updateQuantity(1));
        quantityControl.append(add);
        return;
      }

      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "menu-quantity-button";
      minus.textContent = "−";
      minus.setAttribute("aria-label", `Remove one ${item.name}`);
      minus.addEventListener("click", () => updateQuantity(quantity - 1));

      const count = document.createElement("span");
      count.className = "menu-quantity-count";
      count.textContent = String(quantity);
      count.setAttribute("aria-label", `${quantity} ${item.name} in cart`);
      count.setAttribute("aria-live", "polite");

      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "menu-quantity-button";
      plus.textContent = "+";
      plus.setAttribute("aria-label", `Add one ${item.name}`);
      plus.disabled = quantity >= 99;
      plus.addEventListener("click", () => updateQuantity(quantity + 1));
      quantityControl.append(minus, count, plus);
    };
    renderQuantityControl();
    bottom.append(price, quantityControl); info.append(title, desc, bottom); card.append(imageWrap, info); menuItems.append(card);
  });
}

function getSubtotal() {
  return [...cart.entries()].reduce((sum, [id, qty]) => {
    const item = menu.find(product => product.id === id); return sum + (item ? item.price * qty : 0);
  }, 0);
}

function renderCart() {
  if (cartItems) cartItems.replaceChildren();
  let count = 0;
  for (const [id, qty] of cart) {
    const item = menu.find(product => product.id === id);
    if (!item || qty <= 0) continue;
    count += qty;
    if (!cartItems) continue;
    const row = document.createElement("div"); row.className = "cart-row";
    const details = document.createElement("div"); const name = document.createElement("span"); name.className = "cart-row-name"; name.textContent = item.name;
    const price = document.createElement("span"); price.className = "cart-row-price"; price.textContent = `${money(item.price)} each · ${money(item.price * qty)} total`; details.append(name, price);
    const actions = document.createElement("div"); actions.className = "cart-actions";
    const minus = document.createElement("button"); minus.type = "button"; minus.className = "quantity-button"; minus.textContent = "−"; minus.setAttribute("aria-label", `Remove one ${item.name}`);
    minus.addEventListener("click", () => {
      if (qty <= 1) cart.delete(id); else cart.set(id, qty - 1);
      saveCart();
      renderCart();
    });
    const quantity = document.createElement("span"); quantity.textContent = String(qty); quantity.setAttribute("aria-label", "Quantity");
    const plus = document.createElement("button"); plus.type = "button"; plus.className = "quantity-button"; plus.textContent = "+"; plus.setAttribute("aria-label", `Add one ${item.name}`); plus.disabled = qty >= 99;
    plus.addEventListener("click", () => {
      if (qty < 99) cart.set(id, qty + 1);
      saveCart();
      renderCart();
    });
    actions.append(minus, quantity, plus); row.append(details, actions); cartItems.append(row);
  }
  if (cartItems && count === 0) cartItems.textContent = "Your cart is empty. Add something delicious from our menu!";
  const subtotal = getSubtotal(); const fee = 0;
  if (cartCount) cartCount.textContent = String(count);
  if (menuCartSummary) {
    const hasItems = count > 0;
    menuCartSummary.hidden = !hasItems;
    document.body.classList.toggle("has-menu-cart", hasItems);
    if (menuCartCount) menuCartCount.textContent = String(count);
    if (menuCartTotal) menuCartTotal.textContent = `${count} ${count === 1 ? "item" : "items"} · ${money(subtotal)}`;
    if (menuCartLink) menuCartLink.setAttribute("aria-label", `View cart: ${count} ${count === 1 ? "item" : "items"}, total ${money(subtotal)}`);
  }
  if (cartSubtotal) cartSubtotal.textContent = money(subtotal);
  if (deliveryFee) deliveryFee.textContent = money(fee);
  if (cartTotal) cartTotal.textContent = money(subtotal + fee);
  const checkoutButton = document.getElementById("checkoutBtn");
  if (checkoutButton) checkoutButton.disabled = count === 0;
}

const checkoutButton = document.getElementById("checkoutBtn");
if (checkoutButton) {
  checkoutButton.addEventListener("click", () => {
    if (cart.size === 0) return;
    document.getElementById("order").scrollIntoView({ behavior: "smooth" });
    document.getElementById("customerName").focus({ preventScroll: true });
    orderStatus.textContent = "Your cart is ready. Fill in your details below to continue to payment.";
  });
}

const orderType = document.getElementById("orderType");
if (orderType) {
  orderType.addEventListener("change", event => {
    const address = document.getElementById("customerAddress");
    const isDelivery = event.target.value === "Delivery";
    address.required = isDelivery;
    address.disabled = !isDelivery;
    address.placeholder = isDelivery ? "House no., street, area" : "Not required for pickup";
    document.getElementById("addressField").classList.toggle("field-disabled", !isDelivery);
    if (!isDelivery) address.value = "";
  });
}

if (orderForm) {
  fillCustomerDetails();
  if (paymentMethod) {
    paymentMethod.addEventListener("change", () => {
      const isCash = paymentMethod.value === "CASH";
      paymentMethodNote.textContent = isCash
        ? "Pay the order total in cash when your delivery arrives or when you collect your café pickup."
        : "Pay securely using PhonePe. We verify the transaction before confirming your order.";
      submitOrderButton.textContent = isCash ? "Place cash order →" : "Continue to payment →";
    });
  }
  orderForm.addEventListener("submit", event => {
    event.preventDefault();
    if (cart.size === 0) {
      orderStatus.textContent = "Your cart is empty. Please add items from the menu first.";
      return;
    }
    if (!orderForm.reportValidity()) return;
    beginPayment();
  });
}

async function beginPayment() {
  if (submitOrderButton) submitOrderButton.disabled = true;
  const isCash = paymentMethod && paymentMethod.value === "CASH";
  orderStatus.textContent = isCash ? "Placing your cash order…" : "Creating your secure payment request…";
  try {
    const detailsSaved = saveCustomerDetails();
    const response = await fetch(isCash ? "/api/cash-orders" : "/api/payment-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPaymentRequest())
    });
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Checkout is not connected to a café server on this static preview. No order was placed.");
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not start payment. Please try again.");
    if (isCash) {
      if (typeof result.merchantOrderId !== "string" ||
          !/^[A-Za-z0-9_-]{12,63}$/.test(result.merchantOrderId) ||
          result.paymentMethod !== "CASH" ||
          (result.orderType !== "Delivery" && result.orderType !== "Pickup")) {
        throw new Error("The café server returned an invalid cash order confirmation.");
      }
      showCashOrderConfirmation(result);
      showNotificationResults(result.notifications);
      if (!detailsSaved) orderStatus.textContent = "Your order was placed, but your contact details could not be saved for next time.";
      return;
    }
    if (typeof result.redirectUrl !== "string" ||
        typeof result.merchantOrderId !== "string" ||
        !/^[A-Za-z0-9_-]{12,63}$/.test(result.merchantOrderId)) {
      throw new Error("The payment service returned an invalid response.");
    }
    const redirect = new URL(result.redirectUrl);
    if (redirect.protocol !== "https:" ||
        !(redirect.hostname === "phonepe.com" || redirect.hostname.endsWith(".phonepe.com"))) {
      throw new Error("The payment service returned an invalid payment URL.");
    }
    if (!detailsSaved) orderStatus.textContent = "Your contact details could not be saved for next time.";
    window.location.assign(redirect.href);
  } catch (error) {
    console.error("Could not start the PhonePe payment.", error);
    orderStatus.textContent = error instanceof TypeError && error.message === "Failed to fetch"
      ? "Could not reach the café server. Start the Node server or use the deployed Node website to place an order."
      : error.message;
    if (submitOrderButton) submitOrderButton.disabled = false;
  }
}

function showCashOrderConfirmation(order) {
  paymentPanel.hidden = false;
  paymentPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  paymentStatusDescription.textContent = "Your cash order has been sent to the café.";
  paymentVerificationStatus.classList.remove("payment-status-failed");
  paymentVerificationStatus.classList.add("payment-status-success");
  paymentVerificationStatus.textContent = order.orderType === "Pickup"
    ? "Order confirmed — please pay cash when you collect your order."
    : "Order confirmed — please pay cash when your delivery arrives.";
  orderConfirmation.hidden = false;
  confirmedOrderReference.textContent = `Order reference: ${order.merchantOrderId}`;
  deliveryEstimate.textContent = order.orderType === "Pickup"
    ? "Estimated pickup readiness: 15–20 minutes. Cash is due at pickup."
    : "Estimated delivery: 30–45 minutes. Cash is due on delivery.";
  retryPaymentStatus.hidden = true;
  cart.clear();
  saveCart();
  renderCart();
}

let paymentChecks = 0;

async function checkPaymentStatus() {
  if (!activePaymentOrderId || !paymentVerificationStatus) return;
  if (paymentStatusTimer) clearTimeout(paymentStatusTimer);
  retryPaymentStatus.hidden = true;
  paymentVerificationStatus.classList.remove("payment-status-success", "payment-status-failed");
  paymentVerificationStatus.textContent = "Checking payment status with PhonePe…";
  try {
    const response = await fetch(`/api/payment-orders/${encodeURIComponent(activePaymentOrderId)}/status`, {
      cache: "no-store"
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not verify your payment right now.");
    if (result.notifications) showNotificationResults(result.notifications);
    if (result.status === "SUCCESS") {
      if (typeof result.orderReference !== "string" ||
          (result.orderType !== "Delivery" && result.orderType !== "Pickup")) {
        throw new Error("The payment service returned an incomplete order confirmation.");
      }
      paymentVerificationStatus.classList.add("payment-status-success");
      paymentVerificationStatus.textContent = "Payment successful — verified by PhonePe.";
      paymentStatusDescription.textContent = "Your payment has been confirmed.";
      orderConfirmation.hidden = false;
      confirmedOrderReference.textContent = `Order reference: ${result.orderReference}`;
      deliveryEstimate.textContent = result.orderType === "Pickup"
        ? "Estimated pickup readiness: 15–20 minutes."
        : "Estimated delivery: 30–45 minutes.";
      cart.clear();
      saveCart();
      renderCart();
      return;
    }
    if (result.status === "FAILED") {
      paymentVerificationStatus.classList.add("payment-status-failed");
      paymentVerificationStatus.textContent = "Payment failed or was cancelled. Your order has not been placed.";
      paymentStatusDescription.textContent = "No order confirmation was created.";
      orderStatus.textContent = "Your cart is still available. You can return to Order Details and start a new payment.";
      return;
    }
    if (result.status !== "PENDING") throw new Error("The payment service returned an unknown status.");
    paymentVerificationStatus.textContent = "Payment is still processing. We’ll keep checking with PhonePe.";
    paymentChecks += 1;
    if (paymentChecks < 40) {
      paymentStatusTimer = setTimeout(checkPaymentStatus, 3000);
    } else {
      paymentVerificationStatus.textContent = "Payment is still processing. Check the status again before retrying payment.";
      retryPaymentStatus.hidden = false;
    }
  } catch (error) {
    console.error("Could not verify the PhonePe payment.", error);
    paymentVerificationStatus.textContent = `${error.message} Do not retry payment until its status is checked.`;
    retryPaymentStatus.hidden = false;
  }
}

function showNotificationResults(results) {
  if (!Array.isArray(results)) return;
  const failed = results.filter(result => result.status === "failed");
  const unconfigured = results.filter(result => result.status === "not_configured");
  if (failed.length || unconfigured.length) {
    orderStatus.textContent = "Your order is confirmed, but an email notification could not be sent. Please contact the café if you need an update.";
  }
}

if (retryPaymentStatus) retryPaymentStatus.addEventListener("click", checkPaymentStatus);

const returnedOrderId = new URLSearchParams(window.location.search).get("merchantOrderId");
if (returnedOrderId && /^[A-Za-z0-9_-]{12,63}$/.test(returnedOrderId)) {
  activePaymentOrderId = returnedOrderId;
  paymentChecks = 0;
  paymentPanel.hidden = false;
  checkPaymentStatus();
}

const menuToggle = document.getElementById("menuToggle");
const mainNav = document.getElementById("mainNav");
if (menuToggle && mainNav) {
  menuToggle.addEventListener("click", () => {
    const isOpen = mainNav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });
  mainNav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
    mainNav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  }));
}

const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();
renderFilters();
renderMenu();
renderCart();
