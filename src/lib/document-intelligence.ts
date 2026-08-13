// Azure AI Document Intelligence — prebuilt-receipt model, called over REST (no SDK dependency, same
// approach as the Graph mail code). Returns null when unconfigured so the capture flow degrades
// gracefully to manual entry. The key is server-side only (never sent to the browser).

const API_VERSION = "2024-11-30";
const MODEL_ID = "prebuilt-receipt";
const MAX_POLLS = 30;
const POLL_INTERVAL_MS = 1000;

export type ReceiptItem = { description?: string; quantity?: number; totalPrice?: number };

export type ReceiptExtraction = {
  vendor?: string;
  date?: string; // yyyy-MM-dd
  total?: number;
  currency?: string;
  items: ReceiptItem[];
  confidences: { vendor?: number; date?: number; total?: number; currency?: number };
  docConfidence?: number;
  modelId: string;
  apiVersion: string;
};

function config(): { endpoint: string; key: string } | null {
  const endpoint = process.env.AZURE_DOCINTEL_ENDPOINT?.replace(/\/+$/, "");
  const key = process.env.AZURE_DOCINTEL_KEY;
  if (!endpoint || !key) return null;
  return { endpoint, key };
}

export function docIntelConfigured(): boolean {
  return config() !== null;
}

// Minimal shape of the bits of the Document Intelligence response we read.
type DiField = {
  valueString?: string;
  valueDate?: string;
  valueNumber?: number;
  valueCurrency?: { amount?: number; currencyCode?: string };
  valueArray?: { valueObject?: Record<string, DiField> }[];
  confidence?: number;
  content?: string;
};
type DiResponse = {
  status?: string;
  error?: unknown;
  analyzeResult?: { documents?: { fields?: Record<string, DiField>; confidence?: number }[] };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Analyzes a receipt image. Returns null if Azure isn't configured; throws on API/timeout errors
 *  (the caller keeps the draft and lets the user fill fields manually). */
export async function analyzeReceipt(bytes: Buffer, contentType: string): Promise<ReceiptExtraction | null> {
  const cfg = config();
  if (!cfg) return null;

  const analyzeUrl = `${cfg.endpoint}/documentintelligence/documentModels/${MODEL_ID}:analyze?api-version=${API_VERSION}`;
  const submit = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": cfg.key,
      "Content-Type": contentType || "application/octet-stream",
    },
    body: new Uint8Array(bytes),
  });
  if (submit.status !== 202) {
    throw new Error(`Document Intelligence submit failed (${submit.status}): ${await submit.text()}`);
  }
  const opLocation = submit.headers.get("operation-location");
  if (!opLocation) throw new Error("Document Intelligence: missing operation-location header.");

  let result: DiResponse | null = null;
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await fetch(opLocation, { headers: { "Ocp-Apim-Subscription-Key": cfg.key } });
    if (!poll.ok) throw new Error(`Document Intelligence poll failed (${poll.status}): ${await poll.text()}`);
    const json = (await poll.json()) as DiResponse;
    if (json.status === "succeeded") {
      result = json;
      break;
    }
    if (json.status === "failed") {
      throw new Error(`Document Intelligence analysis failed: ${JSON.stringify(json.error ?? {})}`);
    }
  }
  if (!result) throw new Error("Document Intelligence timed out.");

  const doc = result.analyzeResult?.documents?.[0];
  const f = doc?.fields ?? {};
  const total = f.Total?.valueCurrency?.amount ?? f.Total?.valueNumber;
  const currency = f.Total?.valueCurrency?.currencyCode;
  const items: ReceiptItem[] = (f.Items?.valueArray ?? []).map((it) => {
    const o = it.valueObject ?? {};
    return {
      description: o.Description?.valueString,
      quantity: o.Quantity?.valueNumber,
      totalPrice: o.TotalPrice?.valueCurrency?.amount ?? o.TotalPrice?.valueNumber,
    };
  });

  return {
    vendor: f.MerchantName?.valueString,
    date: f.TransactionDate?.valueDate,
    total: typeof total === "number" ? total : undefined,
    currency: typeof currency === "string" ? currency : undefined,
    items,
    confidences: {
      vendor: f.MerchantName?.confidence,
      date: f.TransactionDate?.confidence,
      total: f.Total?.confidence,
      currency: f.Total?.confidence,
    },
    docConfidence: doc?.confidence,
    modelId: MODEL_ID,
    apiVersion: API_VERSION,
  };
}
