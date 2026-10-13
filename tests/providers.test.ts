import { describe, it, expect, vi, afterEach } from "vitest";
import { providers } from "../server/providers.js";
import { getConfig } from "../server/config.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("external provider contracts (mocked network)", () => {
  it("sends confirmation mail through the Brevo transactional endpoint", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-provider-key");
    vi.stubEnv("MAIL_FROM", "security@example.com");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await providers().mail({
      to: "user@example.com",
      subject: "Confirm",
      text: "Test confirmation link",
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(options.headers["api-key"]).toBe("test-provider-key");
    expect(JSON.parse(options.body)).toEqual({
      sender: { name: "Clearance", email: "security@example.com" },
      to: [{ email: "user@example.com" }],
      subject: "Confirm",
      textContent: "Test confirmation link",
    });
  });
  it("reports missing email credentials and does not fabricate delivery", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      providers().mail({
        to: "u@example.com",
        subject: "Confirm",
        text: "Link",
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sanitizes email-provider errors", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-provider-key");
    vi.stubEnv("MAIL_FROM", "security@example.com");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("provider internal secret", { status: 401 }),
        ),
    );
    await expect(
      providers().mail({
        to: "u@example.com",
        subject: "Confirm",
        text: "Link",
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: "Email provider could not accept the message. Please try again.",
    });
  });
  it("uses Twilio Verify channels and only accepts approved verification", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "VAtest");
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"status":"pending"}'))
      .mockResolvedValueOnce(new Response('{"status":"approved"}'))
      .mockResolvedValueOnce(new Response('{"status":"pending"}'));
    vi.stubGlobal("fetch", f);
    const p = providers();
    await p.otpSend("+40712345678", "whatsapp");
    expect(f.mock.calls[0][0]).toBe(
      "https://verify.twilio.com/v2/Services/VAtest/Verifications",
    );
    expect(f.mock.calls[0][1].body.get("Channel")).toBe("whatsapp");
    expect(await p.otpCheck("+40712345678", "123456")).toBe(true);
    expect(await p.otpCheck("+40712345678", "000000")).toBe(false);
  });
  it("refuses OTP when the provider is not configured", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    await expect(
      providers().otpSend("+40712345678", "sms"),
    ).rejects.toMatchObject({ status: 503 });
  });
});
describe("production configuration", () => {
  it("refuses an in-memory demo in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DB_DRIVER", "memory");
    expect(() => getConfig()).toThrow("forbidden");
  });
  it("requires HTTPS public URLs and a database", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DB_DRIVER", "postgres");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("APP_URL", "http://example.com");
    vi.stubEnv("API_URL", "http://example.com");
    expect(() => getConfig()).toThrow("HTTPS");
    vi.stubEnv("APP_URL", "https://example.com");
    vi.stubEnv("API_URL", "https://example.com");
    vi.stubEnv("DATABASE_URL", "");
    expect(() => getConfig()).toThrow("DATABASE_URL");
  });
});
