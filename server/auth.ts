import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import rateLimit from "express-rate-limit";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { DB } from "./db.js";
import type { Config } from "./config.js";
import type { Providers } from "./providers.js";
import {
  id,
  token,
  hash,
  passwordHash,
  passwordMatches,
  HttpError,
  audit,
} from "./security.js";
import { emailSchema, passwordSchema } from "./validation.js";
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      scopes?: string[];
      sessionCreated?: Date;
    }
  }
}
const publicUser = (u: any) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  verified: u.verified,
  mfa_enabled: u.mfa_enabled,
});
export function authServices(db: DB, config: Config) {
  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: "lax" as const,
    path: "/",
  };
  async function issue(userId: string, res: Response) {
    const raw = token();
    await db.query(
      "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)",
      [hash(raw), userId, new Date(Date.now() + 7 * 86400000)],
    );
    res.cookie("clearance_session", raw, {
      ...cookieOptions,
      maxAge: 7 * 86400000,
    });
  }
  async function makeToken(
    userId: string | null,
    kind: string,
    payload: object = {},
    minutes = 30,
  ) {
    const raw = token();
    await db.query(
      "INSERT INTO auth_tokens (token_hash,user_id,kind,payload,expires_at) VALUES ($1,$2,$3,$4,$5)",
      [
        hash(raw),
        userId,
        kind,
        JSON.stringify(payload),
        new Date(Date.now() + minutes * 60000),
      ],
    );
    return raw;
  }
  async function consume(raw: string, kind: string) {
    const row = (
      await db.query(
        "DELETE FROM auth_tokens WHERE token_hash=$1 AND kind=$2 AND expires_at > $3 RETURNING *",
        [hash(raw), kind, new Date()],
      )
    ).rows[0];
    if (!row)
      throw new HttpError(
        400,
        "This link or challenge is invalid or expired. Request a new one.",
      );
    return row;
  }
  const requireAuth = async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ) => {
    try {
      const bearer = req.headers.authorization;
      if (bearer?.startsWith("Bearer ")) {
        const key = (
          await db.query(
            "SELECT * FROM api_keys WHERE token_hash=$1 AND expires_at > $2",
            [hash(bearer.slice(7)), new Date()],
          )
        ).rows[0];
        if (!key) throw new HttpError(401, "Invalid or expired API key.");
        req.userId = key.user_id;
        req.scopes = key.scopes;
      } else {
        const raw = req.cookies.clearance_session;
        if (!raw) throw new HttpError(401, "Sign in to continue.");
        const session = (
          await db.query(
            "SELECT * FROM sessions WHERE token_hash=$1 AND expires_at > $2",
            [hash(raw), new Date()],
          )
        ).rows[0];
        if (!session) throw new HttpError(401, "Your session has expired.");
        req.userId = session.user_id;
        req.sessionCreated = new Date(session.created_at);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
  const browserOnly = (req: Request, _res: Response, next: NextFunction) => {
    if (req.scopes)
      return next(
        new HttpError(
          403,
          "Use an interactive browser session for this action.",
        ),
      );
    next();
  };
  const scope =
    (needed: string) => (req: Request, _res: Response, next: NextFunction) => {
      if (req.scopes && !req.scopes.includes(needed))
        return next(new HttpError(403, `API key requires ${needed} scope.`));
      next();
    };
  return {
    issue,
    makeToken,
    consume,
    requireAuth,
    browserOnly,
    scope,
    cookieOptions,
  };
}
export function authRouter(
  db: DB,
  config: Config,
  provider: Providers,
  auth: ReturnType<typeof authServices>,
) {
  const router = Router();
  const limit = rateLimit({
    windowMs: 15 * 60000,
    limit: 40,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Session reads already have the general API budget; navigation is not a login attempt.
    skip: (req) => req.method === "GET" && req.path === "/me",
    message: {
      error: "Too many authentication attempts. Please try again later.",
    },
  });
  router.use(limit);
  const dummyHashPromise = passwordHash(token());
  async function sendLink(user: any, kind: "verify" | "reset") {
    const raw = await auth.makeToken(user.id, kind);
    try {
      await provider.mail({
        to: user.email,
        subject:
          kind === "verify"
            ? "Confirm your Clearance email"
            : "Reset your Clearance password",
        text: `${kind === "verify" ? "Confirm your email" : "Reset your password"} using this link. It expires in 30 minutes.\n\n${config.appUrl}/${kind}#token=${raw}\n\nIf you did not request this, ignore this email.`,
      });
    } catch (error) {
      await db.query("DELETE FROM auth_tokens WHERE token_hash=$1", [
        hash(raw),
      ]);
      throw error;
    }
  }
  router.post("/register", async (req, res) => {
    const data = z
      .object({
        email: emailSchema,
        password: passwordSchema,
        name: z.string().trim().min(2).max(80),
      })
      .parse(req.body);
    let user = (
      await db.query("SELECT * FROM users WHERE email=$1", [data.email])
    ).rows[0];
    if (!user) {
      const uid = id();
      await db.query(
        "INSERT INTO users (id,email,name,password_hash) VALUES ($1,$2,$3,$4)",
        [uid, data.email, data.name, await passwordHash(data.password)],
      );
      user = { id: uid, email: data.email };
      await audit(db, uid, "account.created", uid);
      await sendLink(user, "verify");
    }
    res.status(202).json({
      message:
        "If this address can be registered, a confirmation email is on its way. Already registered? Sign in or request a reset.",
    });
  });
  router.post("/resend", async (req, res) => {
    const email = emailSchema.parse(req.body.email);
    const user = (await db.query("SELECT * FROM users WHERE email=$1", [email]))
      .rows[0];
    if (user && !user.verified) await sendLink(user, "verify");
    res.json({ message: "If confirmation is needed, an email is on its way." });
  });
  router.post("/verify", async (req, res) => {
    const raw = z.string().min(20).max(200).parse(req.body.token);
    const row = await auth.consume(raw, "verify");
    await db.query("UPDATE users SET verified=true WHERE id=$1", [row.user_id]);
    await audit(db, row.user_id, "email.verified", row.user_id);
    res.json({ message: "Email confirmed. You can now sign in." });
  });
  const accountLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    skipSuccessfulRequests: true,
    keyGenerator: (req) =>
      hash(
        typeof req.body?.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "invalid-email",
      ),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many failed sign-ins for this account. Try again later.",
    },
  });
  router.post("/login", accountLimit, async (req, res) => {
    const { email, password } = z
      .object({ email: emailSchema, password: z.string().max(128) })
      .parse(req.body);
    const user = (await db.query("SELECT * FROM users WHERE email=$1", [email]))
      .rows[0];
    const valid = await passwordMatches(
      password,
      user?.password_hash || (await dummyHashPromise),
    );
    if (!user?.password_hash || !valid)
      throw new HttpError(401, "Email or password is incorrect.");
    if (!user.verified)
      throw new HttpError(403, "Confirm your email before signing in.");
    if (user.mfa_enabled) {
      const challenge = await auth.makeToken(
        user.id,
        "mfa",
        { phone: user.phone },
        5,
      );
      return res.json({ needsMfa: true, challenge });
    }
    await auth.issue(user.id, res);
    await audit(db, user.id, "auth.login", user.id);
    res.json({ user: publicUser(user) });
  });
  router.post("/forgot", async (req, res) => {
    const email = emailSchema.parse(req.body.email);
    const user = (await db.query("SELECT * FROM users WHERE email=$1", [email]))
      .rows[0];
    if (user?.password_hash) await sendLink(user, "reset");
    res.json({
      message: "If a password account exists, a reset email is on its way.",
    });
  });
  router.post("/reset", async (req, res) => {
    const data = z
      .object({ token: z.string().min(20).max(200), password: passwordSchema })
      .parse(req.body);
    const encoded = await passwordHash(data.password);
    const row = await auth.consume(data.token, "reset");
    await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      encoded,
      row.user_id,
    ]);
    await db.query("DELETE FROM sessions WHERE user_id=$1", [row.user_id]);
    await db.query("DELETE FROM auth_tokens WHERE user_id=$1", [row.user_id]);
    await db.query("DELETE FROM api_keys WHERE user_id=$1", [row.user_id]);
    await audit(db, row.user_id, "password.reset", row.user_id);
    res.json({ message: "Password updated. Sign in with your new password." });
  });
  router.post(
    "/logout",
    auth.requireAuth,
    auth.browserOnly,
    async (req, res) => {
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        hash(req.cookies.clearance_session),
      ]);
      res
        .clearCookie("clearance_session", auth.cookieOptions)
        .json({ ok: true });
    },
  );
  router.get("/me", auth.requireAuth, async (req, res) => {
    const u = (await db.query("SELECT * FROM users WHERE id=$1", [req.userId]))
      .rows[0];
    res.json({ user: publicUser(u) });
  });
  router.post(
    "/mfa/enroll",
    auth.requireAuth,
    auth.browserOnly,
    async (req, res) => {
      const data = z
        .object({
          phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
          channel: z.enum(["sms", "whatsapp"]),
          password: z.string().max(128).optional(),
        })
        .parse(req.body);
      const user = (
        await db.query("SELECT * FROM users WHERE id=$1", [req.userId])
      ).rows[0];
      if (user.mfa_enabled)
        throw new HttpError(409, "Two-step verification is already enabled.");
      if (
        user.password_hash &&
        (!data.password ||
          !(await passwordMatches(data.password, user.password_hash)))
      )
        throw new HttpError(403, "Confirm your current password.");
      if (
        !user.password_hash &&
        (!req.sessionCreated ||
          Date.now() - req.sessionCreated.getTime() > 600000)
      )
        throw new HttpError(
          403,
          "Sign in with Google again before enabling verification.",
        );
      await provider.otpSend(data.phone, data.channel);
      const challenge = await auth.makeToken(
        user.id,
        "enroll",
        { phone: data.phone },
        5,
      );
      res.json({ challenge, message: "Verification code sent." });
    },
  );
  router.post("/mfa/send", async (req, res) => {
    const { challenge, channel } = z
      .object({
        challenge: z.string().min(20).max(200),
        channel: z.enum(["sms", "whatsapp"]),
      })
      .parse(req.body);
    const row = (
      await db.query(
        "UPDATE auth_tokens SET attempts=attempts+1 WHERE token_hash=$1 AND kind=$2 AND expires_at > $3 AND attempts < 5 RETURNING *",
        [hash(challenge), "mfa", new Date()],
      )
    ).rows[0];
    if (!row)
      throw new HttpError(400, "Invalid, expired or exhausted challenge.");
    await provider.otpSend(row.payload.phone, channel);
    res.json({ message: "Verification code sent." });
  });
  router.post("/mfa/verify", async (req, res) => {
    const { challenge, code } = z
      .object({
        challenge: z.string().min(20).max(200),
        code: z.string().regex(/^\d{4,10}$/),
      })
      .parse(req.body);
    const row = (
      await db.query(
        "UPDATE auth_tokens SET attempts=attempts+1 WHERE token_hash=$1 AND expires_at > $2 AND attempts < 10 RETURNING *",
        [hash(challenge), new Date()],
      )
    ).rows[0];
    if (!row || !["mfa", "enroll"].includes(row.kind))
      throw new HttpError(400, "Invalid, expired or exhausted challenge.");
    if (!(await provider.otpCheck(row.payload.phone, code)))
      throw new HttpError(400, "The verification code is incorrect.");
    await auth.consume(challenge, row.kind);
    if (row.kind === "enroll")
      await db.query("UPDATE users SET phone=$1,mfa_enabled=true WHERE id=$2", [
        row.payload.phone,
        row.user_id,
      ]);
    await auth.issue(row.user_id, res);
    await audit(
      db,
      row.user_id,
      row.kind === "enroll" ? "mfa.enabled" : "auth.mfa_verified",
      row.user_id,
    );
    res.json({ ok: true });
  });
  router.get("/google", async (_req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      throw new HttpError(503, "Google sign-in is not configured.");
    const verifier = token();
    const nonce = token();
    const state = await auth.makeToken(null, "oauth", { verifier, nonce }, 10);
    res.cookie("clearance_oauth", state, {
      ...auth.cookieOptions,
      maxAge: 600000,
    });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${config.apiUrl}/api/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });
  router.get("/google/callback", async (req, res) => {
    const { state, code } = z
      .object({
        state: z.string().min(20).max(200),
        code: z.string().min(1).max(4000),
      })
      .parse(req.query);
    if (req.cookies.clearance_oauth !== state)
      throw new HttpError(400, "Invalid OAuth state.");
    const pending = await auth.consume(state, "oauth");
    res.clearCookie("clearance_oauth", auth.cookieOptions);
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${config.apiUrl}/api/auth/google/callback`,
    );
    const { tokens } = await client.getToken({
      code,
      codeVerifier: pending.payload.verifier,
    });
    if (!tokens.id_token)
      throw new HttpError(401, "Google did not return an identity token.");
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const identity = ticket.getPayload();
    if (
      !identity?.email_verified ||
      !identity.email ||
      (identity as any).nonce !== pending.payload.nonce
    )
      throw new HttpError(401, "Google identity could not be verified.");
    let user = (
      await db.query("SELECT * FROM users WHERE google_sub=$1", [identity.sub])
    ).rows[0];
    if (!user) {
      if (
        (
          await db.query("SELECT id FROM users WHERE email=$1", [
            identity.email.toLowerCase(),
          ])
        ).rows[0]
      )
        throw new HttpError(
          409,
          "This email already has an account. Use its existing sign-in method.",
        );
      const uid = id();
      await db.query(
        "INSERT INTO users (id,email,name,google_sub,verified) VALUES ($1,$2,$3,$4,true)",
        [
          uid,
          identity.email.toLowerCase(),
          identity.name || "Member",
          identity.sub,
        ],
      );
      user = { id: uid };
    }
    if (user.mfa_enabled) {
      const challenge = await auth.makeToken(
        user.id,
        "mfa",
        { phone: user.phone },
        5,
      );
      return res.redirect(`${config.appUrl}/login#challenge=${challenge}`);
    }
    await auth.issue(user.id, res);
    await audit(db, user.id, "auth.google_login", user.id);
    res.redirect(`${config.appUrl}/app`);
  });
  return router;
}
