import type { Category, CheckId, Severity } from "../types";

export type CheckDef = {
  id: CheckId;
  title: string;
  description: string;
  recommendation: string;
  severity: Severity;
  category: Category;
  kind: "code" | "configuration" | "dependency";
  confidence: "high" | "medium" | "low";
  /**
   * Standalone checks report even when no in-scope control references them (they are
   * security defects on their own). Policy checks only report under a control.
   */
  standalone: boolean;
};

export type LineCheck = CheckDef & {
  type: "line";
  /** Languages (from walk.languageOf) the check applies to. */
  langs: RegExp;
  pattern: RegExp;
  /** The line is ignored if it also matches this. */
  exclude?: RegExp;
  /** Must match within +/- `window` lines (for example "token" near Math.random). */
  near?: RegExp;
  /** Test `near` against the line's code only: string literals reduced to their interpolations. */
  nearInCode?: boolean;
  /** Also test `near` on the next line when the matched line continues (ends with + , ( or :). */
  continuation?: boolean;
  /** Must NOT match within the window (for example "secure" near res.cookie). */
  notNear?: RegExp;
  window?: number;
  /** Comment lines are skipped unless this is set (config files use comments meaningfully). */
  allowComments?: boolean;
  /** Also flag test files (default false). */
  includeTests?: boolean;
  /** Only when the whole project matches (for example embedded-only checks). */
  projectGate?: "embedded" | "llm";
  /** Only files whose content matches this. */
  fileGate?: RegExp;
  /** Only files whose path matches this. */
  paths?: RegExp;
  /** Skip files whose path matches this (translations, build tooling, debug variants). */
  excludePaths?: RegExp;
};

const I18N = /(^|\/)(locales?|i18n|l10n|translations?|lang|strings)\/|\.(po|xliff|strings)$/i;
const BUILD_TOOLING = /(^|\/)(Podfile|Gemfile|Fastfile|Rakefile|Vagrantfile|Brewfile|Dangerfile)$/;
const DEBUG_VARIANT = /(^|\/)src\/debug\w*\//;

export type RepoCheck = CheckDef & {
  type: "repo";
  /** Evaluated by name in run.ts. */
};

const C = /^(C|C\+\+|C\/C\+\+ header|Arduino)$/;
const JS = /^(JavaScript|TypeScript|Vue|Svelte)$/;
const PY = /^Python$/;
const CODE = /^(C|C\+\+|C\/C\+\+ header|Arduino|JavaScript|TypeScript|Python|Go|Rust|Java|Kotlin|Swift|Objective-C|C#|Ruby|PHP|Dart|Scala|Vue|Svelte|Shell|PowerShell)$/;
const CONFIG = /^(JSON|YAML|TOML|INI|Config|Env|XML|Dockerfile|Properties|Terraform|Make|CMake|Gradle)$/;
const CODE_OR_CONFIG = new RegExp(`${CODE.source}|${CONFIG.source}`);
const WEB = /^(HTML|JavaScript|TypeScript|Vue|Svelte|PHP|Ruby|Python|Java|C#)$/;

const PLACEHOLDER = /(\$\{|process\.env|os\.environ|getenv|System\.getenv|ENV\[|<[A-Z_]+>|your[-_ ]|example|xxxx|\*\*\*\*|placeholder|dummy|redacted|changeme_in_prod|\{\{)/i;
// Sensitive identifiers as whole words in snake_case, camelCase or CONSTANT_CASE ("outputTokens" and "passed" do not match).
const SENSITIVE_WORD = /(?<![A-Za-z])(password|passwd|passphrase|pass|psk|pwd|secret|token|api_?key|ssn|cnp|card_?number|cvv|email|phone|symptoms?|diagnos[ie]s|patient|dob|date_?of_?birth|iban)(?![a-z])|(?<=[a-z])(Password|Passwd|Passphrase|Pass|Secret|Token|ApiKey|CardNumber|Email|Phone|Symptoms?|Diagnosis|Patient|Iban)(?![a-z])|(?<![A-Za-z])(PASSWORD|PASSWD|PASS|PSK|SECRET|TOKEN|API_KEY|EMAIL|PHONE)(?![A-Z])/;

export const LINE_CHECKS: LineCheck[] = [
  {
    id: "hardcoded-secret", type: "line", title: "Hard-coded secret in source",
    description: "A credential, API key, token or private key is committed in the repository. Anyone with read access to the code, its history or the built artifact can use it.",
    recommendation: "Remove the value, rotate the credential immediately, and load it from a secret store or environment variable at runtime. Purge it from git history if the repository was shared.",
    severity: "critical", category: "secrets-management", kind: "code", confidence: "high", standalone: true,
    langs: CODE_OR_CONFIG,
    pattern: /\b(sk-ant-(api|admin)\d{2}-[A-Za-z0-9_-]{20,}|sk-(proj-|svcacct-)?[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[abpors]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,})\b|-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----|\b(password|passwd|secret|api_?key|apikey|auth_?token|access_?token|client_?secret|private_?key)\w*["']?\s*[:=]\s*["'](?=[^"'\s]*\d)(?=[^"'\s]*[A-Za-z])[^"'\s]{8,}["']/i,
    exclude: PLACEHOLDER,
    excludePaths: I18N,
  },
  {
    id: "default-credentials", type: "line", title: "Universal default credentials",
    description: "The product ships with a fixed default username and password, or a factory PIN shared by all units. Product-security laws (EU RED and CRA, UK PSTI, ETSI EN 303 645) ban universal default passwords.",
    recommendation: "Generate a unique per-device credential at manufacture or force the user to set one at first use; reject well-known defaults.",
    severity: "high", category: "authentication-access", kind: "code", confidence: "medium", standalone: true,
    langs: CODE_OR_CONFIG,
    pattern: /["'](admin|root|user|guest|operator)["']\s*[,:]\s*["'](admin|root|password|pass|1234|12345|123456|0000|default|changeme|guest)["']|\b(DEFAULT|FACTORY|ADMIN)_?(PASSWORD|PASSWD|PASS|PIN|PWD)\b\s*[=:]?\s*["']|#define\s+\w*(DEFAULT|ADMIN|FACTORY)\w*(PASS|PWD|PIN)\w*\s+"[^"]+"|\b(password|passwd|pwd|pin)\w*\s*[:=]\s*["'](admin|password|1234|12345|123456|0000|changeme|default|letmein)["']|=\s*(DEFAULT|FACTORY)_\w*(PASSWORD|PASSWD|PASS|PIN)\w*\s*;/i,
  },
  {
    id: "hardcoded-crypto-key", type: "line", title: "Hard-coded cryptographic key",
    description: "A symmetric key, IV or key material is embedded in source. It is identical on every build and recoverable from firmware or binaries.",
    recommendation: "Provision keys per device in secure storage (HSM, secure element, eFuse, Keychain or Keystore, KMS) and never commit key material.",
    severity: "high", category: "cryptography", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /\b(uint8_t|unsigned\s+char|u8|byte|char)\s+\w*(key|iv|secret|aes|hmac)\w*\s*\[\s*\w*\s*\]\s*=\s*\{\s*(0x|\d|$)|\b\w*(aes|hmac|crypto|cipher|encryption|signing)_?(key|iv|secret)\w*\s*[:=]\s*(b?["'][0-9a-fA-F]{16,}["']|Buffer\.from\(\s*["'][^"']{16,}["'])|createCipheriv\(\s*["'][^"']+["']\s*,\s*["'][^"']{8,}["']/i,
    exclude: PLACEHOLDER,
  },
  {
    id: "weak-hash", type: "line", title: "Weak hash algorithm (MD5 or SHA-1)",
    description: "MD5 and SHA-1 are broken for collision resistance and must not protect integrity, signatures or credentials.",
    recommendation: "Use SHA-256 or SHA-3 for integrity, HMAC-SHA-256 for authentication, and Argon2id, scrypt, bcrypt or PBKDF2 for passwords.",
    severity: "medium", category: "cryptography", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /createHash\(\s*["'](md5|sha1)["']|hashlib\.(md5|sha1)\(|MessageDigest\.getInstance\(\s*"(MD5|SHA-?1)"|\b(MD5|SHA1)_(Init|Update|Final)\b|mbedtls_(md5|sha1)_\w+|\bCC_(MD5|SHA1)\(|Digest::(MD5|SHA1)|\bmd5\(\s*\$|Insecure\.(MD5|SHA1)|crypto\/(md5|sha1)"/,
    exclude: /usedforsecurity\s*=\s*False/,
  },
  {
    id: "weak-cipher", type: "line", title: "Weak cipher or mode (DES, 3DES, RC4, ECB)",
    description: "Obsolete ciphers or ECB mode leak plaintext structure or can be brute-forced.",
    recommendation: "Use AES-GCM or ChaCha20-Poly1305 with unique nonces, through a vetted library.",
    severity: "high", category: "cryptography", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /["'](des|des-ede3?|des3|3des|rc4|arc4|bf|blowfish)(-[a-z0-9]+)?["']|\b(DES|DESede|TripleDES|RC4|ARC4|Blowfish)\b\s*[.(/]|\bAES\/ECB\b|aes-\d{3}-ecb|MODE_ECB|_ECB\b|\bECB\(|createCipher\(/,
  },
  {
    id: "insecure-random", type: "line", title: "Non-cryptographic random for security values",
    description: "A predictable PRNG generates a token, key, nonce, salt or session identifier. Attackers can predict the output.",
    recommendation: "Use a CSPRNG: crypto.randomBytes / crypto.getRandomValues, Python secrets, SecureRandom, or the hardware TRNG (esp_fill_random, mbedtls_ctr_drbg).",
    severity: "high", category: "cryptography", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /Math\.random\(\)|\brand\(\)|\brandom\(\)|\bsrand\(|\brandom\.(random|randint|choice|getrandbits)\(|new Random\(|java\.util\.Random\b|math\/rand"/,
    near: /(token|secret|nonce|salt|passw|\botp\b|\biv\b|csrf|auth|api_?key|challenge|crypt|session|login)/i,
    notNear: /analytic|telemetry|tracking|metric|\bui\b|animation|jitter|shuffle/i,
    window: 3,
    excludePaths: /analytic|telemetry|tracking|metrics/i,
  },
  {
    id: "tls-verification-disabled", type: "line", title: "TLS certificate verification disabled",
    description: "Certificate or hostname verification is turned off, so any network attacker can impersonate the server and read or modify traffic.",
    recommendation: "Keep verification on. Pin or bundle the CA for private endpoints instead of disabling checks.",
    severity: "high", category: "communications-security", kind: "code", confidence: "high", standalone: true,
    langs: CODE_OR_CONFIG,
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED["'\]]*\s*[=:]\s*["']?0|\bverify\s*=\s*False|ssl\._create_unverified_context|\bCERT_NONE\b|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFY(PEER|HOST)\s*,\s*0|MBEDTLS_SSL_VERIFY_NONE|\bSSL_VERIFY_NONE\b|ALLOW_ALL_HOSTNAME_VERIFIER|trustAllCerts|TrustAllCerts|skip_cert_common_name_check\s*=\s*true|checkServerIdentity\s*:\s*\(\)\s*=>|CONFIG_ESP_TLS_INSECURE=y|CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY=y|CONFIG_ESP_HTTPS_OTA_ALLOW_HTTP=y|ServerCertificateValidationCallback\s*=.*true/,
  },
  {
    id: "cleartext-transport", type: "line", title: "Cleartext network protocol",
    description: "Data is sent over an unencrypted protocol (HTTP, MQTT, WebSocket, FTP or Telnet) to a non-local host.",
    recommendation: "Use TLS (https, mqtts, wss, ftps or SSH) with certificate verification, and reject downgrade.",
    severity: "medium", category: "communications-security", kind: "code", confidence: "medium", standalone: true,
    langs: CODE_OR_CONFIG,
    pattern: /\b(http|ws|mqtt|ftp|telnet|coap|amqp|tcp):\/\/(?!localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^/\s"']*\.(local|internal|test|example)\b|example\.(com|org|net)|www\.w3\.org|schemas\.|json-schema\.org|www\.apache\.org|purl\.org|ns\.adobe|xmlpull)/i,
    exclude: /xmlns|DOCTYPE|@see|license|\$\{|http:\/\/\$|"\$schema"/i,
  },
  {
    id: "sql-injection-risk", type: "line", title: "SQL built from interpolated input",
    description: "A SQL statement is assembled with string interpolation or concatenation. If any part comes from user input, an attacker can change the query.",
    recommendation: "Use parameterised queries or prepared statements (placeholders such as ? or $1) and never interpolate values into SQL text.",
    severity: "high", category: "input-validation", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /`\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE)\b[^`]*\$\{|["'](SELECT|INSERT|UPDATE|DELETE)\b[^"']*["']\s*\+\s*\w|\bf["'](SELECT|INSERT|UPDATE|DELETE)\b[^"']*\{|["'](SELECT|INSERT|UPDATE|DELETE)\b[^"']*%s[^"']*["']\s*%|["'](SELECT|INSERT|UPDATE|DELETE)\b[^"']*\{\}[^"']*["']\s*\.format\(|sprintf\([^,]+,\s*"(SELECT|INSERT|UPDATE|DELETE)\b[^"]*%s/i,
  },
  {
    id: "command-injection-risk", type: "line", title: "Shell command built from input",
    description: "A shell command is executed with interpolated values. Input containing shell metacharacters can run arbitrary commands.",
    recommendation: "Call the program directly with an argument array (execFile, subprocess.run([...]) with shell=False) and validate inputs against an allow-list.",
    severity: "high", category: "input-validation", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /\b(exec|execSync)\(\s*(`[^`]*\$\{|["'][^"']*["']\s*\+)|os\.system\(\s*(f["']|["'][^"']*["']\s*[%+])|subprocess\.\w+\([^)]*shell\s*=\s*True|Runtime\.getRuntime\(\)\.exec\(\s*[^"]|\bsystem\(\s*(cmd|command|buf|buffer|line|input)\w*\s*\)|\bpopen\(\s*(cmd|command|buf|buffer)\w*/,
  },
  {
    id: "dynamic-code-eval", type: "line", title: "Dynamic code evaluation",
    description: "Code is evaluated from a string at runtime. If the string can be influenced by input or a model, it allows code injection.",
    recommendation: "Remove eval or exec. Parse data with JSON or a safe parser and dispatch through an explicit allow-list.",
    severity: "high", category: "input-validation", kind: "code", confidence: "medium", standalone: true,
    langs: /^(JavaScript|TypeScript|Python|PHP|Ruby|Vue|Svelte)$/,
    pattern: /(?<![\w.])eval\(|new Function\(|setTimeout\(\s*["'`]|vm\.runIn(New|This)?Context\(/,
    excludePaths: BUILD_TOOLING,
  },
  {
    id: "unsafe-deserialization", type: "line", title: "Unsafe deserialisation",
    description: "Native deserialisation (pickle, unsafe YAML, Java or .NET serialisation) of data that may be attacker-controlled leads to remote code execution.",
    recommendation: "Load only data formats without code execution (JSON, safe YAML, safetensors), or verify integrity with a signature before loading.",
    severity: "high", category: "input-validation", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /pickle\.loads?\(|cPickle\.|joblib\.load\(|yaml\.load\((?![^)]*SafeLoader)|yaml\.unsafe_load|ObjectInputStream\(|BinaryFormatter\b|\bunserialize\(|Marshal\.load|jsonpickle\.decode|torch\.load\((?![^)]*weights_only\s*=\s*True)/,
  },
  {
    id: "xss-risk", type: "line", title: "HTML injection sink",
    description: "Content is written into the DOM as HTML. Unsanitised user or model content becomes cross-site scripting.",
    recommendation: "Render as text (textContent, framework escaping) or sanitise with a vetted sanitiser such as DOMPurify, and set a strict Content-Security-Policy.",
    severity: "medium", category: "input-validation", kind: "code", confidence: "medium", standalone: true,
    langs: /^(HTML|JavaScript|TypeScript|Vue|Svelte|PHP|Python|Ruby|C#|Java)$/,
    pattern: /dangerouslySetInnerHTML|\.innerHTML\s*[+]?=|\.outerHTML\s*=|\bv-html=|document\.write\(|insertAdjacentHTML\(|\{\{\{[^}]+\}\}\}|\|\s*safe\b|mark_safe\(|Html\.Raw\(|bypassSecurityTrust\w+\(/,
    exclude: /DOMPurify|sanitize/i,
  },
  {
    id: "path-traversal-risk", type: "line", title: "File path built from request input",
    description: "A file path comes from request parameters. Sequences like ../ can read or overwrite files outside the intended directory.",
    recommendation: "Map identifiers to files server-side, or resolve the path and verify it stays inside an allowed base directory.",
    severity: "high", category: "input-validation", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /(readFile|readFileSync|createReadStream|createWriteStream|writeFile|sendFile|unlink|open|fopen|File|Path)\s*\([^)]*\b(req\.(params|query|body)|request\.(args|form|GET|POST|query_params|json)|params\[|query\[|searchParams\.get)|\b\w*(path|file|filename|dir)\w*\s*=\s*\w*(req|request|params|query|body|args|payload)\w*(\.\w+)*\s*(\.get\(|\[)\s*["']\w*(path|file|dir)\w*["']/,
  },
  {
    id: "unsafe-c-functions", type: "line", title: "Unbounded C string function",
    description: "Functions such as strcpy, strcat, sprintf and gets do not check destination size, which leads to buffer overflows (CERT C STR31-C, MISRA C Rule 21.x).",
    recommendation: "Use bounded alternatives (snprintf, strlcpy or strncpy with explicit termination, fgets) and check lengths against the destination buffer.",
    severity: "high", category: "code-safety", kind: "code", confidence: "high", standalone: true,
    langs: C,
    pattern: /\b(strcpy|strcat|sprintf|vsprintf|gets|wcscpy|wcscat|stpcpy)\s*\(|\bscanf\s*\(\s*"[^"]*%s/,
  },
  {
    id: "dynamic-memory-embedded", type: "line", title: "Dynamic memory allocation in firmware",
    description: "Heap allocation in embedded or safety software risks fragmentation, non-deterministic timing and allocation failure at runtime (MISRA C Dir 4.12 and Rule 21.3, ISO 26262-6).",
    recommendation: "Use static or pool allocation sized at build time, or allocate only during initialisation and document a justified deviation.",
    severity: "medium", category: "code-safety", kind: "code", confidence: "high", standalone: false,
    langs: C,
    pattern: /\b(malloc|calloc|realloc|free)\s*\(/,
    projectGate: "embedded",
  },
  {
    id: "goto-statement", type: "line", title: "goto statement",
    description: "goto makes control flow hard to verify. MISRA C Rule 15.1 (advisory) and ISO 26262-6 coding guidelines discourage it.",
    recommendation: "Restructure with early returns or a single cleanup function, or record a MISRA deviation.",
    severity: "low", category: "code-safety", kind: "code", confidence: "high", standalone: false,
    langs: C,
    pattern: /\bgoto\s+\w+\s*;/,
  },
  {
    id: "debug-enabled", type: "line", title: "Debug mode enabled",
    description: "Debug mode in a shipped configuration exposes stack traces, debug endpoints or debuggable builds.",
    recommendation: "Disable debug in production builds and drive it from build type or environment, defaulting to off.",
    severity: "medium", category: "secure-development", kind: "configuration", confidence: "medium", standalone: true,
    langs: CODE_OR_CONFIG,
    pattern: /^\s*DEBUG\s*=\s*(True|1|true)\b|app\.run\([^)]*debug\s*=\s*True|android:debuggable\s*=\s*"true"|FLASK_DEBUG\s*=\s*1|APP_DEBUG\s*=\s*true|DJANGO_DEBUG\s*=\s*True|CONFIG_LOG_DEFAULT_LEVEL_(VERBOSE|DEBUG)=y|\bdebug\s*:\s*true\b.*\bprod/i,
    allowComments: false,
  },
  {
    id: "cors-wildcard", type: "line", title: "Permissive CORS policy",
    description: "Any origin may call the API from a browser. Combined with credentials or cookie auth this exposes user data to any website.",
    recommendation: "Allow only explicit trusted origins and never combine a wildcard or reflected origin with credentials.",
    severity: "medium", category: "communications-security", kind: "code", confidence: "medium", standalone: true,
    langs: CODE_OR_CONFIG,
    pattern: /Access-Control-Allow-Origin["']?\s*[,:]\s*["']\*["']|\bcors\(\s*\)|\borigin\s*:\s*(["']\*["']|true)\b|allow_origins\s*=\s*\[\s*["']\*["']|CORS_ORIGIN_ALLOW_ALL\s*=\s*True|CORS_ALLOW_ALL_ORIGINS\s*=\s*True|AllowAnyOrigin\(\)/i,
  },
  {
    id: "jwt-unverified", type: "line", title: "JWT accepted without verification",
    description: "Tokens are decoded without verifying the signature, or the 'none' algorithm is allowed, so anyone can forge identities.",
    recommendation: "Verify signature, issuer, audience and expiry with a pinned algorithm (jwt.verify, PyJWT decode with algorithms=[...]).",
    severity: "high", category: "authentication-access", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /jwt\.decode\((?![^)]*(verify|algorithms|key))|algorithms\s*[:=]\s*\[?\s*["']none["']|verify_signature["']?\s*:\s*False|ignoreExpiration\s*:\s*true|alg\s*:\s*["']none["']/,
  },
  {
    id: "pii-in-logs", type: "line", title: "Sensitive data written to logs",
    description: "Logs receive credentials or personal, health or payment data. Logs are widely accessible and retained, so this breaks confidentiality and data minimisation.",
    recommendation: "Log identifiers or redacted values only. Add a redaction layer to the logger and review retention.",
    severity: "medium", category: "data-protection", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /(console\.(log|info|debug|warn|error)|\blog(ger)?\.(info|debug|warn|warning|error|log|trace)|logging\.(info|debug|warning|error)|\bprint\(|\bprintf\(|ESP_LOG[IDWEV]\(|\bLOG[DIWEV]?\s*\(|\bLOG_\w+\s*\(|\blog_(debug|info|warn|error)\s*\(|\bLog\.[dviwe]\(|NSLog\(|fmt\.Print|System\.out\.print)/,
    near: SENSITIVE_WORD,
    window: 0,
    nearInCode: true,
    exclude: /redact|mask|\*\*\*|sanitize|hash\(/i,
  },
  {
    id: "error-details-leak", type: "line", title: "Internal error details returned to clients",
    description: "Stack traces or raw exception messages are sent in responses, revealing internals that help attackers.",
    recommendation: "Return a generic error with a correlation id and log details server-side only.",
    severity: "medium", category: "logging-monitoring", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /(send|json|write|end|render|jsonify|Response)\([^)]*\b(err|error|e|ex|exception)\.(stack|stackTrace)|stack\s*:\s*(err|error|e)\.stack|traceback\.format_exc\(\)|printStackTrace\(\s*response|DEBUG_PROPAGATE_EXCEPTIONS\s*=\s*True/,
  },
  {
    id: "insecure-cookie", type: "line", title: "Cookie without Secure or HttpOnly",
    description: "Session cookies without Secure or HttpOnly can leak over HTTP or be read by scripts after an XSS.",
    recommendation: "Set Secure, HttpOnly and SameSite on session and auth cookies.",
    severity: "medium", category: "authentication-access", kind: "code", confidence: "low", standalone: true,
    langs: CODE,
    pattern: /res\.cookie\(|Set-Cookie["']?\s*[,:]|httpOnly\s*:\s*false|secure\s*:\s*false|SESSION_COOKIE_SECURE\s*=\s*False|SESSION_COOKIE_HTTPONLY\s*=\s*False|set_cookie\(/i,
    notNear: /\bsecure\b(?!\s*:\s*false)/i,
    window: 3,
  },
  {
    id: "weak-password-hash", type: "line", title: "Passwords hashed with a fast or unsalted hash",
    description: "Passwords are stored with a general-purpose hash (MD5, SHA-1, SHA-256) instead of a slow, salted password hash, so leaked hashes are cracked quickly.",
    recommendation: "Use Argon2id, scrypt, bcrypt or PBKDF2 with a per-user salt and a calibrated work factor, and rehash on login.",
    severity: "high", category: "authentication-access", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /createHash\(\s*["'](md5|sha1|sha256|sha512)["']|hashlib\.(md5|sha1|sha256|sha512)\(|MessageDigest\.getInstance|\bmd5\(|\bsha1\(|DigestUtils\.(md5|sha1|sha256)/i,
    near: /(passw|pwd|pass_?hash|hash_?pass|credential|api_?key)/i,
    window: 3,
  },
  {
    id: "mobile-cleartext-allowed", type: "line", title: "Mobile app allows cleartext traffic",
    description: "The app permits unencrypted HTTP connections (Android cleartext or iOS ATS exceptions).",
    recommendation: "Remove the exception and use HTTPS; scope any unavoidable exception to specific domains.",
    severity: "high", category: "communications-security", kind: "configuration", confidence: "high", standalone: true,
    langs: /^XML$/,
    pattern: /usesCleartextTraffic\s*=\s*"true"|cleartextTrafficPermitted\s*=\s*"true"|<key>NSAllowsArbitraryLoads<\/key>/,
    excludePaths: DEBUG_VARIANT,
    near: /usesCleartextTraffic|cleartextTrafficPermitted|<true\s*\/>/,
    window: 1,
  },
  {
    id: "mobile-backup-allowed", type: "line", title: "Android backup of app data enabled",
    description: "allowBackup lets app data, including tokens and personal data, be extracted through backups.",
    recommendation: "Set android:allowBackup=\"false\" or define dataExtractionRules that exclude sensitive files.",
    severity: "low", category: "data-protection", kind: "configuration", confidence: "high", standalone: false,
    langs: /^XML$/,
    pattern: /android:allowBackup\s*=\s*"true"/,
    excludePaths: DEBUG_VARIANT,
  },
  {
    id: "mobile-exported-component", type: "line", title: "Exported Android component without permission",
    description: "An exported activity, service, receiver or provider can be invoked by any app on the device.",
    recommendation: "Set android:exported=\"false\" unless required, and protect required ones with a signature-level permission.",
    severity: "medium", category: "authentication-access", kind: "configuration", confidence: "low", standalone: true,
    langs: /^XML$/,
    pattern: /android:exported\s*=\s*"true"/,
    excludePaths: DEBUG_VARIANT,
    notNear: /android:permission|android\.intent\.action\.MAIN|LAUNCHER/,
    window: 4,
  },
  {
    id: "analytics-tracking-sdk", type: "line", title: "Analytics or advertising SDK",
    description: "An analytics or advertising SDK reads or stores data on the user's device. In the EU this needs prior consent (ePrivacy Art. 5(3)) unless strictly necessary, and app stores need it declared.",
    recommendation: "Load the SDK only after opt-in consent, record the consent, honour withdrawal, and declare it in privacy labels and the privacy policy.",
    severity: "medium", category: "privacy-rights", kind: "code", confidence: "medium", standalone: false,
    langs: /^(HTML|JavaScript|TypeScript|Vue|Svelte|Swift|Kotlin|Java|Dart|Gradle|Ruby|XML|JSON|Objective-C)$/,
    pattern: /googletagmanager\.com\/gtag|google-analytics\.com|gtag\(\s*["']config|firebase\/analytics|getAnalytics\(|FirebaseAnalytics|firebase-analytics|mixpanel\.(init|track)|analytics\.load\(|amplitude\.(init|getInstance)|posthog\.init|static\.hotjar\.com|connect\.facebook\.net|fbq\(\s*["']init|AppsFlyerLib|Adjust\.(start|onCreate)|play-services-ads|GoogleMobileAds/,
    includeTests: false,
  },
  {
    id: "llm-prompt-injection-risk", type: "line", title: "Untrusted input placed in the system prompt",
    description: "User-controlled text is concatenated into system or developer instructions, so users can override the model's rules (OWASP LLM01).",
    recommendation: "Keep system instructions static. Pass user content only in the user turn, delimit and label it as untrusted, and constrain tools and outputs server-side.",
    severity: "high", category: "ai-security", kind: "code", confidence: "medium", standalone: true,
    langs: CODE,
    pattern: /system_?prompt|systemPrompt|SYSTEM_PROMPT|role["']?\s*:\s*["'](system|developer)["']|\bsystem\s*[:=]\s*\S/,
    // Interpolation or concatenation of a non-constant value (ALL_CAPS constants are fine).
    near: /\$\{\s*(?![A-Z0-9_]+\s*\})[^}]+\}|\+\s*(?![A-Z0-9_]+\b)[a-z_][\w.]*|\bf["'][^"']*\{(?![A-Z0-9_]+\})[^}]+\}|\.format\(|%\s*\(?\s*[a-z_]\w*/,
    window: 0,
    continuation: true,
    projectGate: "llm",
  },
  {
    id: "llm-output-execution", type: "line", title: "Model output drives code execution",
    description: "Text produced by a language model is passed to eval, a shell, SQL or a dynamic function lookup without validation (OWASP LLM05 Improper Output Handling).",
    recommendation: "Parse model output against a strict schema, dispatch only through an allow-list of actions, and never execute generated code without sandboxing and human approval.",
    severity: "high", category: "ai-security", kind: "code", confidence: "low", standalone: true,
    langs: CODE,
    pattern: /(?<![\w.])eval\(|new Function\(|(?<![\w.])exec\(|subprocess\.|os\.system\(|child_process|\b\w+\[\s*\w*(\.\w+)*(action|tool|function|command|fn|handler)\w*\s*\]|getattr\(\s*\w+\s*,\s*\w+(\.\w+|\[["']\w+["']\])*\s*\)\s*\(/i,
    near: /(completion|choices\[0\]|content\[0\]|\bllm\b|\bmodel\b|model_?(output|response)|assistant|ai_?(response|reply|output)|parsed|\breply\b)/i,
    window: 6,
    exclude: /\.exec\(|RegExp/,
    projectGate: "llm",
  },
  {
    id: "debug-interface-enabled", type: "line", title: "Debug interface or readout left open",
    description: "JTAG or SWD remains enabled, or flash readout protection is at level 0, so firmware and keys can be extracted or modified with physical access.",
    recommendation: "Disable or lock debug ports in production (eFuse, RDP level 1 or 2, JTAG disable) and document the production lock procedure.",
    severity: "high", category: "hardware-security", kind: "configuration", confidence: "high", standalone: true,
    langs: /^(C|C\+\+|C\/C\+\+ header|Config|INI|Make|CMake|Arduino)$/,
    pattern: /OB_RDP_LEVEL_0|RDP_LEVEL_0|__HAL_AFIO_REMAP_SWJ_ENABLE|CONFIG_ESP32_JTAG_ENABLED=y|CONFIG_SECURE_BOOT_ALLOW_JTAG=y|CONFIG_SECURE_FLASH_UART_BOOTLOADER_ALLOW_DEC=y|#define\s+\w*(JTAG|SWD)\w*_?(EN|ENABLE|ENABLED)\s+(1|true)\b|CONFIG_\w*JTAG\w*=y/,
    allowComments: true,
  },
  {
    id: "secure-boot-disabled", type: "line", title: "Secure boot or flash encryption disabled",
    description: "The build configuration does not enable secure boot or flash encryption, so modified firmware can run and firmware secrets can be read.",
    recommendation: "Enable secure boot (for example ESP-IDF Secure Boot V2 or MCUboot with signed images) and flash encryption in release configurations.",
    severity: "high", category: "hardware-security", kind: "configuration", confidence: "high", standalone: true,
    langs: /^(Config|INI|Make|CMake)$/,
    pattern: /#\s*CONFIG_SECURE_BOOT is not set|CONFIG_SECURE_BOOT=n|#\s*CONFIG_SECURE_FLASH_ENC_ENABLED is not set|CONFIG_SECURE_FLASH_ENC_ENABLED=n|CONFIG_SECURE_BOOT_INSECURE=y|#\s*CONFIG_BOOTLOADER_MCUBOOT is not set|CONFIG_SECURE_FLASH_ENCRYPTION_MODE_DEVELOPMENT=y/,
    allowComments: true,
  },
  {
    id: "uds-weak-security-access", type: "line", title: "Weak UDS SecurityAccess seed or key",
    description: "The diagnostic SecurityAccess (0x27) uses a static seed or a trivially reversible key function, so anyone with a diagnostic tool can unlock protected services (UNECE R155 Annex 5).",
    recommendation: "Use a random seed per request and a key derived with a secret held in an HSM (CMAC or asymmetric challenge-response), or move to UDS 0x29 authentication; add attempt counters and delays.",
    severity: "high", category: "authentication-access", kind: "code", confidence: "medium", standalone: true,
    langs: C,
    pattern: /\bseed\w*\s*(\^|\+)\s*(0x[0-9a-f]+|[A-Z_][A-Z0-9_]*\b)|\bkey\w*\s*=\s*\(?\s*\w*seed\w*\s*(\^|\+|<<|>>)|\breturn\s+\(?\s*\w*seed\w*\s*(\^|\+)|\bseed\w*\s*=\s*0x[0-9a-f]{2,}\s*[;u]|#define\s+\w*SEED\w*\s+\(?\s*0x[0-9a-f]+|(static\s+)?const\s+\w+\s+\w*seed\w*\s*(\[\s*\w*\s*\])?\s*=|\w*seed\w*\[\s*\w+\s*\]\s*\^\s*0x[0-9a-f]+/i,
  },
  {
    id: "unpinned-dependencies", type: "line", title: "Unpinned dependency version",
    description: "A dependency floats to any version, so builds are not reproducible and a compromised or breaking release is pulled in automatically.",
    recommendation: "Pin versions or ranges with a lockfile, and update through reviewed dependency PRs.",
    severity: "low", category: "supply-chain", kind: "dependency", confidence: "high", standalone: false,
    langs: /^(JSON|Dockerfile|Text)$/,
    pattern: /^\s*"[@\w./-]+"\s*:\s*"(\*|latest|x|>=?\s*[\d.]+)"\s*,?\s*$|^\s*FROM\s+[\w./-]+(:latest)?\s*(AS\s+\w+)?\s*$/i,
    exclude: /"version"\s*:|"node"\s*:|"npm"\s*:/,
    includeTests: true,
  },
];

function dup(id: CheckId): LineCheck {
  const base = LINE_CHECKS.find((c) => c.id === id);
  if (!base) throw new Error(`unknown check ${id}`);
  return base;
}

// Second patterns for checks whose language-specific form differs.
LINE_CHECKS.push(
  {
    ...dup("hardcoded-secret"),
    langs: /^(Env|Config|INI|Properties|YAML|TOML|Dockerfile)$/,
    pattern: /^\s*(export\s+|ENV\s+)?[A-Z0-9_]*(SECRET|TOKEN|API_KEY|APIKEY|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[=:]\s*["']?[^\s#$"'{<]{8,}/,
    excludePaths: /(^|\/)[^/]*\.(example|sample|template|dist)$|\.example\.|\.sample\./i,
  },
  {
    ...dup("dynamic-code-eval"),
    langs: PY,
    pattern: /(^|[=(:,]\s*)exec\(|\bcompile\([^)]*["']exec["']/,
  },
  {
    ...dup("unpinned-dependencies"),
    langs: /^Text$/,
    paths: /(^|\/)requirements[^/]*\.txt$/,
    pattern: /^\s*[A-Za-z0-9_.\[\]-]+\s*(>=?[^=,]*)?\s*$/,
    exclude: /^\s*(-|#)/,
  },
);

export const REPO_CHECKS: RepoCheck[] = [
  {
    id: "docker-root-user", type: "repo", title: "Container runs as root",
    description: "The container image has no USER instruction (or switches back to root), so a compromise of the process gets root inside the container.",
    recommendation: "Create an unprivileged user and add USER before the entrypoint; drop capabilities at runtime.",
    severity: "medium", category: "secure-development", kind: "configuration", confidence: "high", standalone: true,
  },
  {
    id: "firmware-update-unsigned", type: "repo", title: "Firmware update without signature verification",
    description: "Update code downloads and installs images, but no signature or authenticity verification was found, so a malicious image can be installed.",
    recommendation: "Sign images and verify the signature before activation (MCUboot, ESP-IDF Secure Boot V2, Uptane), with anti-rollback and fallback to the last good image.",
    severity: "critical", category: "updates-maintenance", kind: "code", confidence: "medium", standalone: true,
  },
  {
    id: "can-unauthenticated", type: "repo", title: "CAN messages without authentication or E2E protection",
    description: "Vehicle bus messages are sent and accepted without message authentication (SecOC) or end-to-end protection (CRC, alive counter), so spoofed or corrupted frames are trusted.",
    recommendation: "Add AUTOSAR SecOC (CMAC with freshness values) for security-relevant PDUs and E2E protection profiles with plausibility checks for safety-relevant signals.",
    severity: "high", category: "communications-security", kind: "code", confidence: "medium", standalone: true,
  },
  {
    id: "missing-watchdog", type: "repo", title: "No watchdog in firmware",
    description: "No hardware or task watchdog was found, so a hung task or loop is never detected and the device does not recover to a safe state.",
    recommendation: "Enable the hardware watchdog (and task or program-flow monitoring for safety software) and service it only when all monitored tasks report progress.",
    severity: "medium", category: "functional-safety", kind: "code", confidence: "medium", standalone: false,
  },
  {
    id: "missing-security-headers", type: "repo", title: "Web server sets no security headers",
    description: "No Content-Security-Policy, HSTS or frame protection headers were found in the web server.",
    recommendation: "Add security headers (for example helmet for Express) with a strict CSP, HSTS, X-Content-Type-Options and frame-ancestors.",
    severity: "medium", category: "communications-security", kind: "code", confidence: "low", standalone: true,
  },
  {
    id: "missing-rate-limiting", type: "repo", title: "Authentication without rate limiting",
    description: "Login or token endpoints exist but no rate limiting or lockout was found, so credentials can be brute-forced.",
    recommendation: "Rate-limit authentication endpoints per account and per IP, with exponential backoff or temporary lockout.",
    severity: "medium", category: "authentication-access", kind: "code", confidence: "low", standalone: true,
  },
  {
    id: "ai-disclosure-missing", type: "repo", title: "No disclosure that users interact with AI",
    description: "A user-facing AI feature was found, but no text tells users they are interacting with AI (EU AI Act Art. 50(1)).",
    recommendation: "Show a clear notice before or at the start of the interaction that the user is talking to an AI system, and label AI-generated content.",
    severity: "medium", category: "transparency-documentation", kind: "code", confidence: "low", standalone: false,
  },
];

export const ALL_CHECKS: CheckDef[] = [...LINE_CHECKS, ...REPO_CHECKS];
export const CHECK_BY_ID = new Map<string, CheckDef>(ALL_CHECKS.map((c) => [c.id, c]));
