import {
  ModelArch,
  TranscribeFlags,
  Transcriber,
  type Stream,
  type TranscriptLine,
} from "@moonshine-ai/moonshine-wasm";

type Request =
  | { id: number; type: "initialize"; files: Array<{ name: string; bytes: ArrayBuffer }> }
  | { id: number; type: "start" }
  | { id: number; type: "audio"; samples: ArrayBuffer }
  | { id: number; type: "stop" }
  | { id: number; type: "close" };

type Response =
  | { id: number; type: "ok"; transcript?: string }
  | { id: number; type: "error"; message: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Response): void;
  close(): void;
};

const scope = globalThis as unknown as WorkerScope;
let transcriber: Transcriber | null = null;
let stream: Stream | null = null;
const lines = new Map<string, string>();

scope.onmessage = (event) => {
  void handle(event.data).catch((error: unknown) => {
    scope.postMessage({
      id: event.data.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

async function handle(request: Request): Promise<void> {
  switch (request.type) {
    case "initialize": {
      closeResources();
      const files = new Map(
        request.files.map(({ name, bytes }) => [name, new Uint8Array(bytes)]),
      );
      transcriber = await Transcriber.load({
        files,
        modelArch: ModelArch.TinyStreaming,
      });
      respond(request.id);
      return;
    }
    case "start": {
      if (!transcriber) throw new Error("moonshine_not_initialized");
      stream?.close();
      lines.clear();
      stream = transcriber.createStream({ updateInterval: 0.5 });
      stream.addListener({
        onLineUpdated: ({ line }) => rememberLine(line),
        onLineCompleted: ({ line }) => rememberLine(line),
      });
      stream.start();
      respond(request.id);
      return;
    }
    case "audio": {
      if (!stream) throw new Error("moonshine_stream_not_started");
      stream.addAudio(new Float32Array(request.samples), 16_000);
      const transcript = stream.transcribe();
      for (const line of transcript.lines) rememberLine(line);
      respond(request.id);
      return;
    }
    case "stop": {
      if (!stream) throw new Error("moonshine_stream_not_started");
      stream.stop();
      const transcript = stream.transcribe(TranscribeFlags.ForceUpdate);
      for (const line of transcript.lines) rememberLine(line);
      const text = [...lines.values()].join("\n");
      stream.close();
      stream = null;
      scope.postMessage({ id: request.id, type: "ok", transcript: text });
      return;
    }
    case "close":
      closeResources();
      respond(request.id);
      scope.close();
  }
}

function rememberLine(line: TranscriptLine): void {
  lines.set(line.id, line.text);
}

function respond(id: number): void {
  scope.postMessage({ id, type: "ok" });
}

function closeResources(): void {
  stream?.close();
  transcriber?.close();
  stream = null;
  transcriber = null;
  lines.clear();
}

