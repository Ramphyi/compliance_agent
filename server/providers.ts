import { HttpError } from "./security.js";
export type Mail = { to: string; subject: string; text: string };
export type Providers = {
  mail: (mail: Mail) => Promise<void>;
  otpSend: (phone: string, channel: "sms" | "whatsapp") => Promise<void>;
  otpCheck: (phone: string, code: string) => Promise<boolean>;
};
export function providers(): Providers {
  async function verify(path: string, body: Record<string, string>) {
    const {
      TWILIO_ACCOUNT_SID: sid,
      TWILIO_AUTH_TOKEN: secret,
      TWILIO_VERIFY_SERVICE_SID: service,
    } = process.env;
    if (!sid || !secret || !service)
      throw new HttpError(
        503,
        "SMS and WhatsApp verification are not configured.",
      );
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${service}/${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${secret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new HttpError(
        502,
        "Verification provider could not complete the request.",
      );
    return response.json() as Promise<{ status: string }>;
  }
  return {
    async mail(mail) {
      if (!process.env.BREVO_API_KEY || !process.env.MAIL_FROM)
        throw new HttpError(
          503,
          "Email delivery is not configured. Set Brevo credentials and a verified sender.",
        );
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: "Clearance", email: process.env.MAIL_FROM },
          to: [{ email: mail.to }],
          subject: mail.subject,
          textContent: mail.text,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new HttpError(
          502,
          "Email provider could not accept the message. Please try again.",
        );
    },
    async otpSend(phone, channel) {
      await verify("Verifications", { To: phone, Channel: channel });
    },
    async otpCheck(phone, code) {
      return (
        (await verify("VerificationCheck", { To: phone, Code: code }))
          .status === "approved"
      );
    },
  };
}
