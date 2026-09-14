import { G2CredentialVault } from "./credentials";

export type PairingPointer = { accountId: string; deviceFamilyId: string };
export type G2Session = PairingPointer & { accessToken: string; expiresAt: number; scopes: string[] };
type TokenResponse = { accessToken: string; refreshToken: string; expiresIn: number; scopes: string[]; device: { id: string } };
const REFRESH_WINDOW_MS = 30_000;
const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
type G2Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function responseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/\r?\n/u)) {
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator > 0) headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return headers;
}

export function createXhrFetcher(
  createRequest: () => XMLHttpRequest = () => new XMLHttpRequest(),
): G2Fetcher {
  return (input, init = {}) => new Promise<Response>((resolve, reject) => {
    const request = createRequest();
    const signal = init.signal;
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      operation();
    };
    const abort = () => {
      request.abort();
      finish(() => reject(signal?.reason ?? new DOMException("Request aborted", "AbortError")));
    };
    request.open(init.method ?? "GET", String(input), true);
    request.responseType = "arraybuffer";
    for (const [name, value] of new Headers(init.headers)) request.setRequestHeader(name, value);
    request.onload = () => finish(() => resolve(new Response(
      request.status === 204 || request.status === 205 ? null : request.response,
      { status: request.status, statusText: request.statusText, headers: responseHeaders(request.getAllResponseHeaders()) },
    )));
    request.onerror = () => finish(() => reject(new TypeError("network_request_failed")));
    request.onabort = () => finish(() => reject(new DOMException("Request aborted", "AbortError")));
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    request.send((init.body ?? null) as XMLHttpRequestBodyInit | null);
  });
}

class G2AuthRequestError extends Error {
  constructor(
    message: string,
    readonly definitive = false,
    readonly setupRequired = false,
  ) {
    super(message);
  }
}

export type PairingFailureReason = "invalid" | "connection";

export function pairingFailureReason(error: unknown): PairingFailureReason {
  return error instanceof Error && error.message === "pairing_refused" ? "invalid" : "connection";
}

function base64url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function json64(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function digest(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export class G2AuthClient {
  private session: G2Session | null = null;
  private refreshInFlight: Promise<G2Session> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly vault: G2CredentialVault,
    private readonly fetcher: G2Fetcher = createXhrFetcher(),
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  ) {}

  current(): G2Session | null { return this.session ? { ...this.session, scopes: [...this.session.scopes] } : null; }

  private async fetchWithDeadline(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const parentSignal = init.signal;
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Response>((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort("request_timeout");
          reject(new G2AuthRequestError("request_timeout"));
        }, this.timeoutMs);
        void this.fetcher(input, { ...init, signal: controller.signal }).then(async (response) => {
          const body = await response.arrayBuffer();
          return new Response(body.byteLength > 0 ? body : null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }).then(resolve, reject);
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }

  private async nonce(): Promise<string> {
    const response = await this.fetchWithDeadline(`${this.baseUrl}/v1/g2/auth/nonce`, { cache: "no-store" });
    if (!response.ok) throw new Error("auth_unavailable");
    const body = await response.json() as { nonce?: string };
    if (!body.nonce) throw new Error("auth_unavailable");
    return body.nonce;
  }

  private async proof(method: string, path: string, nonce: string, token?: string): Promise<string> {
    const jwk = await this.vault.createOrLoadProofKey();
    const header = json64({ typ: "dpop+jwt", alg: "ES256", jwk });
    const payload = json64({ htm: method, htu: `${this.baseUrl}${path}`, iat: Math.floor(this.now() / 1000), jti: crypto.randomUUID(), nonce, ...(token ? { ath: await digest(token) } : {}) });
    const signingInput = `${header}.${payload}`;
    return `${signingInput}.${base64url(new Uint8Array(await this.vault.sign(new TextEncoder().encode(signingInput))))}`;
  }

  private async tokenRequest(path: string, body: unknown, token?: string): Promise<TokenResponse> {
    const nonce = await this.nonce();
    const response = await this.fetchWithDeadline(`${this.baseUrl}${path}`, {
      method: "POST", cache: "no-store",
      headers: { "content-type": "application/json", dpop: await this.proof("POST", path, nonce, token), "dpop-nonce": nonce, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let errorCode = "";
      try {
        const error = await response.json() as { error?: unknown };
        if (typeof error.error === "string") errorCode = error.error;
      } catch {
        // An unreadable refusal is never enough evidence to destroy a durable credential.
      }
      const refreshRefused = path === "/v1/g2/auth/refresh" && [400, 401, 403].includes(response.status);
      const definitive = refreshRefused && new Set([
        "invalid_grant",
        "device_revoked",
        "grant_revoked",
        "refresh_revoked",
      ]).has(errorCode);
      throw new G2AuthRequestError(
        response.status === 429 ? "pairing_rate_limited" : "pairing_refused",
        definitive,
        refreshRefused,
      );
    }
    const value = await response.json() as Partial<TokenResponse>;
    if (typeof value.accessToken !== "string" || typeof value.refreshToken !== "string" ||
      typeof value.expiresIn !== "number" || !Number.isFinite(value.expiresIn) || value.expiresIn <= 0 ||
      !Array.isArray(value.scopes) || !value.device || typeof value.device.id !== "string") {
      throw new G2AuthRequestError("auth_unavailable");
    }
    return value as TokenResponse;
  }

  private async acceptTokens(tokens: TokenResponse, accountId: string): Promise<G2Session> {
    const pointer = { accountId, deviceFamilyId: tokens.device.id };
    await this.vault.saveRefresh({ ...pointer, refreshToken: tokens.refreshToken });
    this.session = { ...pointer, accessToken: tokens.accessToken, expiresAt: this.now() + tokens.expiresIn * 1000, scopes: tokens.scopes };
    return this.current() as G2Session;
  }

  async pair(code: string): Promise<G2Session> {
    const normalized = code.replace(/\s+/gu, "").toUpperCase();
    if (!normalized) throw new Error("pairing_refused");
    const tokens = await this.tokenRequest("/v1/g2/pair/redeem", { code: normalized, name: "Even G2" });
    return this.acceptTokens(tokens, crypto.randomUUID());
  }

  async restore(pointer: PairingPointer): Promise<G2Session | null> {
    try {
      const stored = await this.vault.loadRefresh(pointer.accountId, pointer.deviceFamilyId);
      if (!stored) return null;
      const tokens = await this.tokenRequest("/v1/g2/auth/refresh", undefined, stored.refreshToken);
      return await this.acceptTokens(tokens, pointer.accountId);
    } catch (error) {
      if (error instanceof G2AuthRequestError && error.definitive) await this.vault.purge();
      this.session = null;
      return null;
    }
  }

  private async refreshSession(rejectedAccessToken?: string): Promise<G2Session> {
    const current = this.session;
    if (!current) throw new Error("setup_required");
    if (rejectedAccessToken && current.accessToken !== rejectedAccessToken) return current;
    if (this.refreshInFlight) return this.refreshInFlight;

    const refresh = (async () => {
      const stored = await this.vault.loadRefresh(current.accountId, current.deviceFamilyId);
      if (!stored) {
        this.session = null;
        throw new Error("setup_required");
      }
      try {
        const next = await this.tokenRequest("/v1/g2/auth/refresh", undefined, stored.refreshToken);
        return await this.acceptTokens(next, current.accountId);
      } catch (error) {
        if (error instanceof G2AuthRequestError && error.setupRequired) {
          this.session = null;
          if (error.definitive) await this.vault.purge();
          throw new Error("setup_required");
        }
        throw error;
      }
    })();
    this.refreshInFlight = refresh;
    void refresh.finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null;
    }).catch(() => {
      // The authorized caller owns the original rejection; this branch only observes cleanup.
    });
    return refresh;
  }

  private async freshSession(): Promise<G2Session> {
    const current = this.session;
    if (!current) throw new Error("setup_required");
    return current.expiresAt - this.now() <= REFRESH_WINDOW_MS
      ? this.refreshSession()
      : current;
  }

  private async sendAuthorized(path: string, body: unknown, session: G2Session): Promise<Response> {
    const nonce = await this.nonce();
    return this.fetchWithDeadline(`${this.baseUrl}${path}`, {
      method: "POST", cache: "no-store",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.accessToken}`, dpop: await this.proof("POST", path, nonce, session.accessToken), "dpop-nonce": nonce },
      body: JSON.stringify(body),
    });
  }

  async authorized(path: string, body: unknown): Promise<Response> {
    const session = await this.freshSession();
    const response = await this.sendAuthorized(path, body, session);
    if (response.status !== 401) return response;
    const refreshed = await this.refreshSession(session.accessToken);
    return this.sendAuthorized(path, body, refreshed);
  }

  async disconnect(): Promise<void> {
    this.session = null;
    await this.vault.purge();
  }
}

export class G2HttpClient {
  constructor(private readonly auth: G2AuthClient) {}

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.auth.authorized(path, body);
    if (response.status === 401 || response.status === 403) throw new Error("setup_required");
    if (response.status === 429) throw new Error("limit_reached");
    if (!response.ok) {
      const recognizedStates = path === "/v1/g2/commit"
        ? new Set(["queued", "saved", "title_collision", "setup_required", "expired", "confirmation_mismatch", "commit_unknown", "rejected"])
        : path === "/v1/g2/status"
          ? new Set(["queued", "saved", "rejected", "not_found", "setup_required"])
          : null;
      if (recognizedStates) {
        try {
          const result = await response.json() as { state?: unknown };
          if (typeof result.state === "string" && recognizedStates.has(result.state)) return result as T;
        } catch {
          // Fall through to the bounded transport error below.
        }
      }
      throw new Error("request_failed");
    }
    return response.json() as Promise<T>;
  }
}
