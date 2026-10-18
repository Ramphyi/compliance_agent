import type { Answer, Classification, CodeRef, Signal } from "../types";
import type { Snapshot, SourceFile } from "./walk";

type SignalDef = {
  id: string;
  label: string;
  /** Path pattern: any matching file path is a hit. */
  path?: RegExp;
  /** Content pattern, tested line by line on files whose language matches `langs`. */
  content?: RegExp;
  langs?: RegExp;
};

const CODE = /^(C|C\+\+|C\/C\+\+ header|Arduino|JavaScript|TypeScript|Python|Go|Rust|Java|Kotlin|Swift|Objective-C|C#|Ruby|PHP|Dart|Scala|Vue|Svelte)$/;
const C_LIKE = /^(C|C\+\+|C\/C\+\+ header|Arduino)$/;
const ANY_TEXT = /./;

const SIGNALS: SignalDef[] = [
  { id: "embedded-c", label: "Embedded C/C++ (register access, ISRs, HAL)", content: /\bvolatile\s+uint(8|16|32)_t\s*\*|__attribute__\s*\(\(\s*(interrupt|section)|\bHAL_[A-Z]\w+\(|\bIRQHandler\b|\bISR\s*\(|#include\s*[<"](stm32|nrf|esp_|freertos|zephyr|avr\/|driverlib|fsl_|cmsis)/i, langs: C_LIKE },
  { id: "linker-script", label: "Linker script / startup code", path: /\.(ld|icf|sct)$|(^|\/)startup_[^/]+\.(s|S)$/ },
  { id: "rtos", label: "RTOS or embedded SDK (FreeRTOS, Zephyr, ESP-IDF, Arduino, PlatformIO)", path: /(^|\/)(sdkconfig[^/]*|prj\.conf|west\.yml|platformio\.ini|[^/]+\.ino|FreeRTOSConfig\.h)$/, content: /\bxTaskCreate\b|#include\s*<zephyr\/|\besp_err_t\b|\bvTaskDelay\b|\bk_thread_create\b/, langs: C_LIKE },
  { id: "autosar", label: "AUTOSAR modules (Rte, Dcm, Com, SecOC)", path: /\.arxml$/, content: /\b(Rte_(Read|Write|Call)_\w+|Std_ReturnType|Dcm_\w+|Dem_\w+|CanIf_\w+|PduR_\w+|SecOC_\w+|Com_(Send|Receive)Signal)\b/, langs: C_LIKE },
  { id: "can-bus", label: "CAN / CAN FD / LIN communication", path: /\.dbc$/, content: /\b(can_frame|CAN_(Transmit|Receive|Init|TxHeader|RxHeader)\w*|FDCAN_\w+|HAL_CAN_\w+|twai_\w+|MCP2515|socketcan|CanTp_\w+|LinIf_\w+|can_(send|recv|rx|tx)\w*)\b/i, langs: C_LIKE },
  { id: "uds", label: "UDS diagnostics (ISO 14229)", content: /\b(SecurityAccess|SECURITY_ACCESS|DiagnosticSessionControl|RequestDownload|TransferData|uds_\w+|UDS_\w+)\b|0x27\s*[,:)].*(seed|key|security)/i, langs: C_LIKE },
  { id: "ota", label: "Firmware or over-the-air update", content: /(esp_https_ota|esp_ota_\w+|mcuboot|boot_set_pending|dfu_\w+|fw_?update|firmware_?(update|download|image)|(?<![a-z])ota_\w+|swupdate|uptane)/i, langs: CODE },
  { id: "wifi", label: "Wi-Fi", content: /(esp_wifi_\w+|WiFi\.begin|wpa_supplicant|(?<![a-z])wlan_\w+|WIFI_SSID|wifi_?(connect|init|config|ssid|pass|start)\w*)/i, langs: CODE },
  { id: "bluetooth", label: "Bluetooth / BLE", content: /(esp_ble_\w+|nimble|(?<![a-z])ble_(gap|gatts?|prov|adv|init|connect|scan|pair)\w*|BLE(Device|Server|Characteristic)|CoreBluetooth|BluetoothGatt|bt_le_\w+|bluetooth)/i, langs: CODE },
  { id: "cellular", label: "Cellular modem (LTE, NB-IoT)", content: /\bAT\+(CGDCONT|COPS|CREG)|\b(nbiot|lte_modem|modem_(init|connect))\b/i, langs: CODE },
  { id: "mqtt", label: "MQTT messaging", content: /\bmqtts?:\/\/|\b(esp_mqtt_\w+|MQTTClient|paho|mqtt_(connect|publish|subscribe)\w*)\b/i, langs: CODE },
  { id: "fieldbus", label: "Industrial protocol (Modbus, PROFINET, OPC UA, IEC 61850)", content: /\b(modbus|profinet|opcua|open62541|iec61850|ethercat|bacnet|dnp3)\b/i, langs: CODE },
  { id: "web-server", label: "HTTP server or web framework", content: /\b(express\(\)|fastify\(|new Koa\(|@nestjs\/|createServer\(|from flask import|FastAPI\(|django\.|@RestController|gin\.Default\(|http\.HandleFunc|HTTPServer\(|BaseHTTPRequestHandler|Rails\.application|actix_web|axum::)/, langs: CODE },
  { id: "frontend", label: "Web frontend (HTML, SPA framework)", path: /(^|\/)(index\.html|[^/]+\.(vue|svelte))$/, content: /from ["'](react|react-dom|vue|@angular\/core|svelte|next)["/]/, langs: CODE },
  { id: "android", label: "Android app", path: /(^|\/)AndroidManifest\.xml$/ },
  { id: "ios", label: "iOS app", path: /(^|\/)(Info\.plist|[^/]+\.xcodeproj\/project\.pbxproj|Podfile|PrivacyInfo\.xcprivacy)$/, content: /^import (UIKit|SwiftUI)\b/, langs: /^Swift$/ },
  { id: "cross-platform-mobile", label: "React Native / Flutter / Capacitor", path: /(^|\/)(pubspec\.yaml|capacitor\.config\.\w+)$/, content: /"react-native"\s*:|"expo"\s*:/, langs: /^JSON$/ },
  { id: "desktop", label: "Desktop application (Electron, Tauri, Qt, WPF)", content: /"electron"\s*:|tauri::|#include\s*<Q(Application|Widget)|System\.Windows\.Forms|PresentationFramework/, langs: ANY_TEXT },
  { id: "llm", label: "Large language model API", content: /\b(openai|anthropic|@anthropic-ai\/sdk|langchain|llama_index|ollama|chat\.completions|messages\.create|\/v1\/messages|\/v1\/chat\/completions|gpt-4|gpt-5|claude-[a-z0-9-]+|gemini-[0-9]|mistralai|cohere)\b/i, langs: CODE },
  { id: "ml", label: "Machine learning model training or inference", content: /\b(import torch|import tensorflow|from sklearn|import sklearn|xgboost|lightgbm|onnxruntime|tflite|\.fit\(|predict_proba\(|model\.predict\(|sigmoid\(|logistic)/, langs: CODE },
  { id: "personal-data", label: "Personal data fields", content: /\b(email|e_mail|phone(_?number)?|first_?name|last_?name|full_?name|date_?of_?birth|dob|birth_?date|home_?address|postal_?code|national_?id|cnp|ssn|passport)\b/i, langs: CODE },
  { id: "health-data", label: "Health or medical data", content: /\b(patient|diagnos[ie]s|symptom|medical|clinical|ehr|fhir|hl7|dicom|icd-?10|prescription|medication|heart_?rate|blood_?pressure|glucose|triage)\b/i, langs: CODE },
  { id: "genetic-biometric", label: "Genetic or biometric data", content: /\b(genome|genomic|genotype|\bdna\b|snp|\.vcf\b|variant_call|23andme|face_?recognition|fingerprint_?(template|match)|face_?embedding|iris_scan|voiceprint)\b/i, langs: CODE },
  { id: "payment", label: "Payments", content: /\b(stripe|braintree|adyen|paypal|checkout\.com|card_?number|cardholder|\bpan\b|cvv|cvc|iban|payment_?intent)\b/i, langs: CODE },
  { id: "card-data", label: "Raw card data handled", content: /\b(card_?number|cvv|cvc|expiry_?(month|date)|track_?2|cardholder_?name)\b/i, langs: CODE },
  { id: "credit", label: "Credit, lending or insurance decisions", content: /(credit_?score|creditworth|loan_?(application|decision|amount)|(?<![a-z])lend(er|ing)\b|underwrit|credit_?bureau|bureau_?score|default_?probability|insurance_?premium)/i, langs: CODE },
  { id: "hr", label: "Hiring or HR decisions", content: /\b(candidate|applicant|resume|cv_?screen|job_?application|performance_?review)\b/i, langs: CODE },
  { id: "children", label: "Children or minors", content: /\b(child(ren)?|kids?|minor|parental_?consent|under_?13|age_?gate|coppa)\b/i, langs: CODE },
  { id: "location", label: "Precise location", content: /\b(geolocation|latitude|longitude|CLLocationManager|ACCESS_FINE_LOCATION|getCurrentPosition|gps_(fix|read))\b/i, langs: ANY_TEXT },
  { id: "auth", label: "User accounts and authentication", content: /\b(login|sign_?in|password|passwd|jwt|oauth|session_?(id|token)|bcrypt|argon2)\b/i, langs: CODE },
  { id: "analytics", label: "Analytics or advertising SDK", content: /\b(gtag\(|googletagmanager|google-analytics|firebase\/analytics|FirebaseAnalytics|mixpanel|segment\.(com|io)|analytics\.js|amplitude|posthog|hotjar|fbq\(|facebook\.net|AppsFlyer|adjust_sdk)/i, langs: ANY_TEXT },
  { id: "container", label: "Container or cloud deployment", path: /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|[^/]+\.tf|serverless\.ya?ml|fly\.toml|vercel\.json|app\.yaml|Chart\.yaml)$/ },
  { id: "safety", label: "Functional safety language (ASIL, SIL, fail-safe)", content: /\b(ASIL[ _-]?[ABCD]|SIL[ _-]?[1-4]|fail[_-]?safe|safe_?state|safety_?(goal|mechanism|monitor)|plausibility)\b/, langs: ANY_TEXT },
  { id: "vehicle", label: "Vehicle domain (brake, steering, powertrain, ADAS)", content: /\b(brake|abs_|esc_|steering|powertrain|throttle|wheel_?speed|vehicle_?speed|adas|lane_?keep|airbag|odometer|vin)\b/i, langs: C_LIKE },
  { id: "medical-device", label: "Medical device language (IEC 62304, SOUP, intended use)", content: /\b(IEC ?62304|SOUP|intended use|510\(k\)|CE ?mark|UDI|ISO ?14971|software safety class)\b/i, langs: ANY_TEXT },
  { id: "library", label: "Library or SDK packaging", path: /(^|\/)(setup\.py|pyproject\.toml|[^/]+\.gemspec|[^/]+\.podspec|Cargo\.toml)$/ },
];

const README = /(^|\/)readme(\.[a-z]+)?$/i;

function detect(snapshot: Snapshot) {
  const signals: Signal[] = [];
  for (const def of SIGNALS) {
    const refs: CodeRef[] = [];
    if (def.path)
      for (const p of snapshot.paths)
        if (def.path.test(p) && refs.length < 5) refs.push({ path: p });
    if (def.content)
      for (const f of snapshot.files) {
        if (refs.length >= 5) break;
        if (def.langs && !def.langs.test(f.lang)) continue;
        if (/(^|\/)(tests?|__tests__|spec|docs?|examples?)\//i.test(f.path) && def.id !== "frontend") continue;
        for (let i = 0; i < f.lines.length && refs.length < 5; i++) {
          const line = f.lines[i];
          if (line.length < 2000 && def.content.test(line))
            refs.push({ path: f.path, line: i + 1, excerpt: line.trim().slice(0, 160) });
        }
      }
    if (refs.length) signals.push({ id: def.id, label: def.label, refs });
  }
  return signals;
}

function readmeText(files: SourceFile[]) {
  const top = files
    .filter((f) => README.test(f.path))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  return top?.content.slice(0, 6000);
}

const MARKET_WORDS: [RegExp, string][] = [
  [/\b(EU|European Union|EEA|Europe)\b/, "EU"],
  [/\b(Romania|Romanian|România|RO market)\b/i, "RO"],
  [/\b(United Kingdom|UK|Great Britain)\b/, "UK"],
  [/\b(United States|USA|U\.S\.|US market|North America)\b/, "US"],
  [/\bCalifornia\b/, "US-CA"],
  [/\bWashington State\b/, "US-WA"],
  [/\b(Switzerland|Swiss)\b/, "CH"],
  [/\bCanada\b/, "CA"],
  [/\b(UNECE|type[- ]approval)\b/i, "UNECE"],
];

/** Build a classification and draft answers. Every draft is unconfirmed until a human confirms it. */
export function classify(snapshot: Snapshot): {
  classification: Classification;
  inferred: Record<string, Answer>;
} {
  const signals = detect(snapshot);
  const has = (id: string) => signals.some((s) => s.id === id);
  const refsOf = (...ids: string[]) =>
    signals.filter((s) => ids.includes(s.id)).flatMap((s) => s.refs.slice(0, 2));
  const now = new Date().toISOString();
  const readme = readmeText(snapshot.files);
  const readmeLower = readme?.toLowerCase() ?? "";

  const langCount = new Map<string, number>();
  for (const f of snapshot.files)
    if (CODE.test(f.lang) || f.lang === "C/C++ header")
      langCount.set(f.lang, (langCount.get(f.lang) ?? 0) + 1);
  const languages = [...langCount]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files);

  const inferred: Record<string, Answer> = {};
  const put = (id: string, value: string | string[], rationale: string, refs: CodeRef[] = []) => {
    if (Array.isArray(value) && !value.length) return;
    inferred[id] = { value, source: "inferred", confirmed: false, rationale, refs, at: now };
  };

  const cFiles = snapshot.files.filter((f) => /^(C|C\+\+|C\/C\+\+ header|Arduino)$/.test(f.lang)).length;
  const codeFiles = snapshot.files.filter((f) => CODE.test(f.lang) || f.lang === "C/C++ header").length;
  const cDominant = cFiles > 0 && cFiles >= codeFiles * 0.6;
  const LANG_FACT: Record<string, string> = {
    C: "c", Arduino: "c", "C++": "cpp", Rust: "rust", JavaScript: "js-ts", TypeScript: "js-ts", Vue: "js-ts", Svelte: "js-ts",
    Python: "python", Java: "java-kotlin", Kotlin: "java-kotlin", Scala: "java-kotlin", Swift: "swift-objc", "Objective-C": "swift-objc",
    Go: "go", "C#": "csharp", Dart: "dart", PHP: "php-ruby", Ruby: "php-ruby",
  };
  const langFacts = [...new Set(languages.map((l) => LANG_FACT[l.name]).filter(Boolean))];
  if (!langFacts.length && languages.some((l) => l.name === "C/C++ header")) langFacts.push("c");
  put("languages", langFacts, `Source files found: ${languages.map((l) => `${l.name} (${l.files})`).join(", ")}.`);

  const embedded =
    has("embedded-c") || has("linker-script") || has("rtos") ||
    (cDominant && !has("web-server") && !has("desktop") && (has("can-bus") || has("uds") || has("safety") || has("ota") || has("mqtt") || has("vehicle")));
  const radio = has("wifi") || has("bluetooth") || has("cellular");
  const automotive = has("autosar") || ((has("can-bus") || has("uds")) && has("vehicle"));
  const mobile = has("android") || has("ios") || has("cross-platform-mobile");

  const types = new Set<string>();
  if (embedded) types.add("embedded-firmware");
  if (embedded && (radio || has("mqtt"))) types.add("iot-device");
  if (automotive) types.add("automotive-ecu");
  if (has("fieldbus")) types.add("industrial-control");
  if (mobile) types.add("mobile-app");
  if (has("desktop")) types.add("desktop-app");
  if (has("web-server")) types.add("backend-api");
  if (has("frontend") && !embedded) types.add("web-app");
  if (has("web-server") && has("container") && has("auth")) types.add("saas");
  if (has("llm") || has("ml")) types.add("ai-system");
  if (has("medical-device")) types.add("medical-device");
  if (has("library") && !types.size) types.add("library-sdk");
  put("productTypes", [...types], "Derived from code signals: " + signals.map((s) => s.id).join(", "), refsOf("embedded-c", "autosar", "android", "ios", "web-server", "llm", "ml"));

  const sector = new Set<string>();
  if (has("health-data") || has("genetic-biometric") || has("medical-device")) sector.add("healthcare");
  if (has("payment") || has("credit")) sector.add("finance");
  if (automotive || has("vehicle")) sector.add("automotive");
  if (has("fieldbus")) sector.add("industrial-energy");
  if (has("hr") && (has("llm") || has("ml"))) sector.add("employment-hr");
  if (!sector.size) sector.add("general");
  put("sector", [...sector], "Derived from domain vocabulary in code.", refsOf("health-data", "payment", "credit", "vehicle", "fieldbus"));

  const data = new Set<string>();
  if (has("personal-data") || has("auth")) data.add("personal");
  if (has("health-data")) data.add("health");
  if (has("genetic-biometric")) data.add("genetic-biometric");
  if (has("card-data")) data.add("payment-cards");
  if (has("payment") || has("credit")) data.add("financial");
  if (has("children")) data.add("children");
  if (has("location")) data.add("location");
  if (automotive && has("location")) data.add("vehicle");
  if (has("auth")) data.add("credentials");
  if (!data.size) data.add("none");
  put("dataCategories", [...data], "Field names and APIs suggest these data categories.", refsOf("personal-data", "health-data", "genetic-biometric", "card-data", "children", "location"));

  if (has("card-data")) put("paymentHandling", "stores-card-data", "Raw card fields appear in code.", refsOf("card-data"));
  else if (has("payment")) put("paymentHandling", "tokenized-sdk", "A payment provider is referenced but no raw card fields were found.", refsOf("payment"));

  if (has("ml") && !has("llm")) put("aiUsage", "own-models", "Model training or inference code found.", refsOf("ml"));
  else if (has("llm")) put("aiUsage", "third-party-models", "Calls to a hosted LLM API found.", refsOf("llm"));
  else put("aiUsage", "none", "No AI or ML libraries detected.");

  if (has("llm") || has("ml")) {
    const areas = new Set<string>();
    if (has("llm") && (has("web-server") || mobile || has("frontend"))) areas.add("chatbot");
    if (has("credit")) areas.add("essential-services");
    if (has("hr")) areas.add("employment");
    if (has("health-data")) areas.add("medical");
    if (has("genetic-biometric") && /face|finger|iris|voice/i.test(JSON.stringify(refsOf("genetic-biometric")))) areas.add("biometric");
    if (automotive || has("safety")) areas.add("safety-component");
    put("aiRiskAreas", areas.size ? [...areas] : ["none"], "Inferred from how the AI output is used alongside domain data.", refsOf("llm", "ml", "credit", "hr"));
  }

  const conn = new Set<string>();
  if (has("wifi")) conn.add("wifi");
  if (has("bluetooth")) conn.add("bluetooth");
  if (has("cellular")) conn.add("cellular");
  if (has("can-bus")) conn.add("can-bus");
  if (has("fieldbus")) conn.add("fieldbus");
  if (has("mqtt") || has("web-server") || has("llm") || mobile || has("frontend")) conn.add("internet");
  if (!conn.size) conn.add("none");
  put("connectivity", [...conn], "Communication stacks found in code.", refsOf("wifi", "bluetooth", "cellular", "can-bus", "mqtt", "fieldbus"));

  if (has("ota")) put("updates", "ota", "Update code found.", refsOf("ota"));
  else if (automotive && has("uds")) put("updates", "manual", "Reflashing through UDS diagnostics (workshop or end-of-line).", refsOf("uds"));
  else if (mobile) put("updates", "app-store", "Mobile app updates ship through the stores.");
  else if (has("web-server") || has("container")) put("updates", "continuous-deployment", "Hosted service deployed from this repository.", refsOf("container"));

  const dist = new Set<string>();
  if (has("android")) dist.add("google-play");
  if (has("ios")) dist.add("apple-app-store");
  if (has("frontend") || has("web-server")) dist.add("web");
  if (automotive) dist.add("oem-supply");
  else if (embedded) dist.add("preinstalled-hardware");
  put("distribution", [...dist], "Inferred from platform files.", refsOf("android", "ios", "frontend"));

  if (has("safety") || (automotive && has("vehicle")))
    put("safetyCritical", "injury-possible", "Safety vocabulary or vehicle control code found.", refsOf("safety", "vehicle"));

  if (readme) {
    const markets = MARKET_WORDS.filter(([re]) => re.test(readme)).map(([, v]) => v);
    if (markets.length) put("markets", markets, "Markets mentioned in the README.", [{ path: "README.md" }]);
    const audience = new Set<string>();
    if (/\b(consumer|household|homeowner|end[- ]user|patients?|customers? at home)\b/.test(readmeLower)) audience.add("consumers");
    if (/\b(b2b|enterprise|business(es)?|oems?|tier[- ]?1|integrators?)\b/.test(readmeLower)) audience.add("businesses");
    if (/\b(oems?|integrators?|vehicle manufacturers?)\b/.test(readmeLower)) audience.add("oem-integrators");
    if (/\b(clinic(s|ians)?|hospitals?|doctors?|physicians?)\b/.test(readmeLower)) audience.add("healthcare-providers");
    if (/\b(children|kids|minors)\b/.test(readmeLower)) audience.add("children");
    if (audience.size) put("audience", [...audience], "Audience described in the README.", [{ path: "README.md" }]);
    if (/\btier[- ]?1\b/.test(readmeLower)) put("orgRole", "tier1-supplier", "README describes a Tier-1 supplier.");
    const asil = readme.match(/\bASIL[ -]?([ABCD])\b/);
    if (asil) put("asil", asil[1], "ASIL stated in the README.", [{ path: "README.md" }]);
  }

  const frameworks = signals
    .filter((s) => ["rtos", "autosar", "web-server", "frontend", "llm", "ml", "cross-platform-mobile", "desktop"].includes(s.id))
    .map((s) => s.label);

  const typeLabel = [...types].join(", ") || "software";
  const summary =
    `${languages.slice(0, 3).map((l) => l.name).join(" / ") || "Unknown language"} ${typeLabel}` +
    (signals.length ? `. Signals: ${signals.map((s) => s.id).join(", ")}.` : ".");

  return {
    classification: {
      summary,
      productTypes: [...types],
      languages,
      frameworks,
      signals,
      readme,
    },
    inferred,
  };
}
