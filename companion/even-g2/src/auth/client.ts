import { G2CredentialVault } from "./credentials";

export type PairingPointer = { accountId: string; deviceFamilyId: string };
export type G2Session = PairingPointer & { accessToken: string; expiresAt: number; scopes: string[] };
type TokenResponse = { accessToken: string; refreshToken: string; expiresIn: number; scopes: string[]; device: { id: string } };

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

  constructor(
    private readonly baseUrl: string,
    private readonly vault: G2CredentialVault,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  current(): G2Session | null { return this.session ? { ...this.session, scopes: [...this.session.scopes] } : null; }

  private async nonce(): Promise<string> {
    const response = await this.fetcher(`${this.baseUrl}/v1/g2/auth/nonce`, { cache: "no-store" });
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
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST", cache: "no-store",
      headers: { "content-type": "application/json", dpop: await this.proof("POST", path, nonce, token), "dpop-nonce": nonce, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(response.status === 429 ? "pairing_rate_limited" : "pairing_refused");
    return response.json() as Promise<TokenResponse>;
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
    const stored = await this.vault.loadRefresh(pointer.accountId, pointer.deviceFamilyId);
    if (!stored) return null;
    try {
      const tokens = await this.tokenRequest("/v1/g2/auth/refresh", undefined, stored.refreshToken);
      return await this.acceptTokens(tokens, pointer.accountId);
    } catch {
      await this.vault.purge();
      this.session = null;
      return null;
    }
  }

  async authorized(path: string, body: unknown): Promise<Response> {
    const session = this.session;
    if (!session) throw new Error("setup_required");
    const nonce = await this.nonce();
    return this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST", cache: "no-store",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.accessToken}`, dpop: await this.proof("POST", path, nonce, session.accessToken), "dpop-nonce": nonce },
      body: JSON.stringify(body),
    });
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
