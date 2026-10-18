
const nodemailer = require("nodemailer");

async function sendSmtpCheckEmail() {
  const port = Number(process.env.SMTP_PORT || 587);
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const to = process.env.CAFE_NOTIFICATION_EMAIL || process.env.SMTP_USER;

  if (!process.env.SMTP_HOST || !Number.isInteger(port) || !process.env.SMTP_USER ||
      !password || !from || !to) {
    throw new Error("Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, and CAFE_NOTIFICATION_EMAIL in .env.");
  }

  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth: { user: process.env.SMTP_USER, pass: password }
  });

  await transporter.verify();
  console.log("SMTP connection successful.");

  const info = await transporter.sendMail({
    from,
    to,
    subject: "Sun Star Cafe - SMTP Test",
    text: "Your Sun Star Cafe Gmail SMTP setup is working."
  });

  console.log(`Test email sent to ${to}. Message ID: ${info.messageId}`);
}

sendSmtpCheckEmail().catch(error => {
  console.error("Email test failed:", error.message);
  process.exitCode = 1;
});
