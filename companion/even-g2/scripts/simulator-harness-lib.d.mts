import type { RequestListener, Server } from "node:http";

export type HarnessArgs = {
  plusPort: number;
  vitePort: number;
  providerPort: number;
  automationPort: number;
  email: string;
  servicesCheck: boolean;
};

export type HarnessOptions = HarnessArgs & {
  plusBaseUrl: string;
  companionOrigin: string;
  providerBaseUrl: string;
  automationBaseUrl: string;
};

export const G2_V1_SCOPES: readonly string[];
export const SIMULATOR_ATOMS: readonly Record<string, unknown>[];

type TrackedChild = {
  pid?: number;
  exitCode?: number | null;
  _processGroup?: boolean;
  kill(signal?: NodeJS.Signals): unknown;
};

export function trackChildForCleanup<T extends TrackedChild & { once(event: "exit", listener: (...args: unknown[]) => void): unknown }>(children: Set<T>, child: T): T;
export function terminateTrackedChild(child: TrackedChild | undefined, options?: {
  platform?: NodeJS.Platform;
  processKill?: (pid: number, signal?: NodeJS.Signals | number) => unknown;
  signal?: NodeJS.Signals;
}): void;
export function shutdownTrackedChildren(children: Iterable<TrackedChild>, options?: {
  forceGroupsImmediately?: boolean;
  graceMs?: number;
  wait?: (milliseconds: number) => Promise<unknown>;
}): Promise<void>;

export function parseHarnessArgs(args?: string[]): HarnessArgs;
export function validateHarnessOptions(input?: Partial<HarnessArgs>): Omit<HarnessOptions, "email" | "servicesCheck">;
export function serviceEnvironment(
  urls: Pick<HarnessOptions, "plusBaseUrl" | "companionOrigin" | "providerBaseUrl">,
  inherited?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
export function deterministicAnthropicResponse(payload: Record<string, unknown>): {
  content: Array<{ type: "text"; text: string }>;
};
export function createDeterministicProviderHandler(options?: { host?: string; port?: number }): RequestListener;
export function createDeterministicProviderServer(options?: { host?: string; port?: number }): Server;
export function bootstrapSimulatorAccount(options?: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  readMagicToken: () => Promise<string>;
  email?: string;
  atoms?: readonly Record<string, unknown>[];
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}): Promise<{
  session: string;
  pairingCode: string;
  expiresAt?: string;
  email: string;
  consent: Record<string, unknown>;
}>;
export function simulatorCreateTargetPath(row: { id?: string; payload?: { title?: string } }): string;
export function acknowledgeCreateOutbox(options: {
  baseUrl: string;
  session: string;
  signal?: AbortSignal;
  intervalMs?: number;
  requestTimeoutMs?: number;
  onAck?: (id: string) => void;
}): Promise<void>;
