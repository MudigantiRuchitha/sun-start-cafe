const { mkdir, copyFile, readFile, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const output = path.join(root, "dist");
const files = ["index.html", "menu.html", "cart.html", "contact.html", "style.css", "script.js", "menu-data.js"];

async function build() {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await Promise.all(files.map(file => copyFile(path.join(root, file), path.join(output, file))));
  const cartPath = path.join(output, "cart.html");
  const cartHtml = await readFile(cartPath, "utf8");
  const previewNotice = '<p class="payment-warning">This Netlify static preview does not have a PhonePe payment server connected. Payments and order confirmations are unavailable here.</p>\n        ';
  await writeFile(
    cartPath,
    cartHtml.replace('<p id="orderStatus"', `${previewNotice}<p id="orderStatus"`),
    "utf8"
  );
  console.log(`Created static Netlify preview in ${output}`);
}

build().catch(error => {
  console.error("Could not build the Netlify preview.", error);
  process.exitCode = 1;
});
