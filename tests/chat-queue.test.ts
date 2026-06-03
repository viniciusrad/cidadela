import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ChatJob, ChatStreamEvent } from "@/lib/agents/types";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Fake in-memory channel.
  // Consumers are stored by queue name; publish/sendToQueue deliver synchronously
  // to the registered consumer (if one exists).
  const consumers = new Map<
    string,
    (msg: { content: Buffer; properties: { correlationId: string; replyTo?: string } } | null) => void
  >();

  function deliver(
    queue: string,
    buf: Buffer,
    opts: { correlationId?: string; replyTo?: string },
  ) {
    const handler = consumers.get(queue);
    if (handler) {
      handler({
        content: buf,
        properties: {
          correlationId: opts.correlationId ?? "",
          replyTo: opts.replyTo,
        },
      });
    }
  }

  let replyQueueCounter = 0;

  const channel = {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn(async (name: string) => {
      // Exclusive/auto-delete reply queue: name is "" → generate a unique one
      if (name === "") {
        const q = `amq.reply-${++replyQueueCounter}`;
        return { queue: q };
      }
      return { queue: name };
    }),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn(async (queue: string, cb: (msg: unknown) => void) => {
      consumers.set(queue, cb as (msg: { content: Buffer; properties: { correlationId: string; replyTo?: string } } | null) => void);
      return { consumerTag: `tag-${queue}` };
    }),
    publish: vi.fn((
      _exchange: string,
      routingKey: string,
      buf: Buffer,
      opts: { correlationId?: string; replyTo?: string },
    ) => {
      deliver(routingKey, buf, opts);
    }),
    sendToQueue: vi.fn((
      queue: string,
      buf: Buffer,
      opts: { correlationId?: string; replyTo?: string },
    ) => {
      deliver(queue, buf, opts);
    }),
    ack: vi.fn(),
    nack: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    // expose for tests that need to manually deliver a message to a consumer
    consumers,
    deliver,
  };

  return {
    channel,
    runSectorAgent: vi.fn(),
    appConfig: {
      chatQueueConcurrency: 1,
      chatQueueTimeoutMs: 180000,
      chatQueueChunkFlushMs: 75,
    },
  };
});

// ---------------------------------------------------------------------------
// Module mocks (must come before any import of the module under test)
// ---------------------------------------------------------------------------

vi.mock("@/lib/bus/connection", () => ({
  createBusChannel: vi.fn().mockResolvedValue(mocks.channel),
}));

vi.mock("@/lib/agents/base-agent", () => ({
  runSectorAgent: mocks.runSectorAgent,
}));

vi.mock("@/lib/config", () => ({
  appConfig: mocks.appConfig,
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import { enqueueChatJob, startChatConsumer } from "@/lib/bus/chat-queue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<ChatJob> = {}): ChatJob {
  return {
    traceId: "trace-001",
    sector: "desenvolvimento",
    question: "Como funciona o fluxo?",
    conversationId: "conv-abc",
    allowDelegation: true,
    useRag: true,
    useGraph: false,
    externalContext: undefined,
    ...overrides,
  };
}

function makeEventBuf(event: ChatStreamEvent): Buffer {
  return Buffer.from(JSON.stringify(event));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatJob serialization", () => {
  it("round-trips all fields through JSON serialization", () => {
    const job: ChatJob = {
      traceId: "t-1",
      parentTraceId: "p-1",
      sector: "suporte",
      question: "Qual o prazo de atendimento?",
      conversationId: "c-1",
      allowDelegation: false,
      useRag: true,
      useGraph: true,
      externalContext: {
        label: "ERP",
        markdown: "# ERP\nConteudo",
        guidance: "Use o conteudo do ERP.",
      },
    };

    const roundTripped = JSON.parse(JSON.stringify(job)) as ChatJob;

    expect(roundTripped.traceId).toBe(job.traceId);
    expect(roundTripped.parentTraceId).toBe(job.parentTraceId);
    expect(roundTripped.sector).toBe(job.sector);
    expect(roundTripped.question).toBe(job.question);
    expect(roundTripped.conversationId).toBe(job.conversationId);
    expect(roundTripped.allowDelegation).toBe(job.allowDelegation);
    expect(roundTripped.useRag).toBe(job.useRag);
    expect(roundTripped.useGraph).toBe(job.useGraph);
    expect(roundTripped.externalContext).toEqual(job.externalContext);
  });
});

describe("enqueueChatJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.channel.consumers.clear();
    // Re-wire mocks after clearAllMocks
    mocks.channel.assertExchange.mockResolvedValue(undefined);
    mocks.channel.assertQueue.mockImplementation(async (name: string) => {
      if (name === "") {
        return { queue: "amq.reply-test" };
      }
      return { queue: name };
    });
    mocks.channel.bindQueue.mockResolvedValue(undefined);
    mocks.channel.prefetch.mockResolvedValue(undefined);
    mocks.channel.consume.mockImplementation(async (queue: string, cb: (msg: unknown) => void) => {
      mocks.channel.consumers.set(queue, cb as (msg: { content: Buffer; properties: { correlationId: string; replyTo?: string } } | null) => void);
      return { consumerTag: `tag-${queue}` };
    });
    mocks.channel.publish.mockImplementation((
      _exchange: string,
      routingKey: string,
      buf: Buffer,
      opts: { correlationId?: string; replyTo?: string },
    ) => {
      mocks.channel.deliver(routingKey, buf, opts);
    });
    mocks.channel.sendToQueue.mockImplementation((
      queue: string,
      buf: Buffer,
      opts: { correlationId?: string; replyTo?: string },
    ) => {
      mocks.channel.deliver(queue, buf, opts);
    });
    mocks.channel.ack.mockReset();
    mocks.channel.close.mockResolvedValue(undefined);
  });

  it("forwards events in order until done and resolves", async () => {
    const job = makeJob({ traceId: "trace-order" });
    const received: ChatStreamEvent[] = [];

    // Script runSectorAgent to NOT deliver anything (we do it manually via the reply queue)
    // The loopback: publish to chat.requests → mocks.channel.publish → deliver("chat.requests", ...)
    // → consumer callback for "chat.requests" → but there's no consumer registered yet in enqueueChatJob.
    //
    // enqueueChatJob only registers a consumer on the reply queue, not on chat.requests.
    // So we need to manually deliver reply events after enqueueChatJob has registered the reply consumer.
    //
    // We hook into consume to intercept when the reply consumer is registered, then fire events.
    let resolveEnqueue!: () => void;
    const enqueueSettled = new Promise<void>((r) => { resolveEnqueue = r; });

    const statusEvent: ChatStreamEvent = { type: "status", data: { message: "Iniciando..." } };
    const messageEvent: ChatStreamEvent = { type: "message", data: { chunk: "Resposta aqui" } };
    const doneEvent: ChatStreamEvent = {
      type: "done",
      data: { traceId: job.traceId, citations: [], answered: true },
    };

    // Override publish so that after the job is published we deliver reply events manually
    mocks.channel.publish.mockImplementation(async (
      _exchange: string,
      _routingKey: string,
      _buf: Buffer,
      opts: { correlationId?: string; replyTo?: string },
    ) => {
      // Deliver reply events to the reply queue consumer
      const replyQueue = opts.replyTo ?? "amq.reply-test";
      // Deliver in sequence — the consumer was registered before publish() is called
      const replyConsumer = mocks.channel.consumers.get(replyQueue);
      if (replyConsumer) {
        replyConsumer({ content: makeEventBuf(statusEvent), properties: { correlationId: job.traceId } });
        replyConsumer({ content: makeEventBuf(messageEvent), properties: { correlationId: job.traceId } });
        replyConsumer({ content: makeEventBuf(doneEvent), properties: { correlationId: job.traceId } });
      }
      resolveEnqueue();
    });

    await Promise.all([
      enqueueChatJob(job, (e) => { received.push(e); }),
      enqueueSettled,
    ]);

    expect(received).toHaveLength(3);
    expect(received[0]).toEqual(statusEvent);
    expect(received[1]).toEqual(messageEvent);
    expect(received[2]).toEqual(doneEvent);
  });

  it("ignores messages with a wrong correlationId and resolves on correct done", async () => {
    const job = makeJob({ traceId: "trace-filter" });
    const received: ChatStreamEvent[] = [];

    const wrongEvent: ChatStreamEvent = { type: "status", data: { message: "Mensagem errada" } };
    const doneEvent: ChatStreamEvent = {
      type: "done",
      data: { traceId: job.traceId, citations: [], answered: false },
    };

    mocks.channel.publish.mockImplementation((
      _exchange: string,
      _routingKey: string,
      _buf: Buffer,
      opts: { correlationId?: string; replyTo?: string },
    ) => {
      const replyQueue = opts.replyTo ?? "amq.reply-test";
      const replyConsumer = mocks.channel.consumers.get(replyQueue);
      if (replyConsumer) {
        // Wrong correlationId first
        replyConsumer({ content: makeEventBuf(wrongEvent), properties: { correlationId: "WRONG-ID" } });
        // Correct correlationId → should resolve
        replyConsumer({ content: makeEventBuf(doneEvent), properties: { correlationId: job.traceId } });
      }
    });

    await enqueueChatJob(job, (e) => { received.push(e); });

    // Only the correctly-correlated done event should have been forwarded
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(doneEvent);
  });

  it("rejects with timeout message and closes channel when no reply arrives", async () => {
    vi.useFakeTimers();

    const job = makeJob({ traceId: "trace-timeout" });

    // publish does NOT deliver any reply — just records the call
    mocks.channel.publish.mockImplementation(() => undefined);

    // Attach the rejection handler BEFORE advancing timers so the rejection
    // is never "unhandled" from V8's perspective.
    const promise = enqueueChatJob(job, () => undefined);
    const caught = promise.catch((err: Error) => err);

    // Advance past the configured timeout
    await vi.advanceTimersByTimeAsync(mocks.appConfig.chatQueueTimeoutMs + 1);

    const result = await caught;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("Tempo de espera");
    expect(mocks.channel.close).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe("startChatConsumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.channel.consumers.clear();
    mocks.channel.assertExchange.mockResolvedValue(undefined);
    mocks.channel.assertQueue.mockImplementation(async (name: string) => {
      if (name === "") {
        return { queue: "amq.reply-consumer-test" };
      }
      return { queue: name };
    });
    mocks.channel.bindQueue.mockResolvedValue(undefined);
    mocks.channel.prefetch.mockResolvedValue(undefined);
    mocks.channel.consume.mockImplementation(async (queue: string, cb: (msg: unknown) => void) => {
      mocks.channel.consumers.set(queue, cb as (msg: { content: Buffer; properties: { correlationId: string; replyTo?: string } } | null) => void);
      return { consumerTag: `tag-${queue}` };
    });
    mocks.channel.sendToQueue.mockImplementation((
      queue: string,
      buf: Buffer,
      opts: { correlationId?: string; replyTo?: string },
    ) => {
      mocks.channel.deliver(queue, buf, opts);
    });
    mocks.channel.ack.mockReset();
    mocks.channel.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces message chunks and forwards terminal done, then acks", async () => {
    vi.useFakeTimers();

    const job = makeJob({ traceId: "trace-consumer-coalesce" });
    const replyTo = "reply.q";
    const correlationId = job.traceId;

    // Script runSectorAgent to emit: status, two message chunks, then done
    mocks.runSectorAgent.mockImplementation(
      async (opts: { emit: (event: ChatStreamEvent) => void }) => {
        opts.emit({ type: "status", data: { message: "Pensando..." } });
        opts.emit({ type: "message", data: { chunk: "Olá " } });
        opts.emit({ type: "message", data: { chunk: "mundo" } });
        opts.emit({ type: "done", data: { traceId: job.traceId, citations: [], answered: true } });
      },
    );

    await startChatConsumer();

    // Deliver a job to chat.requests
    const chatRequestsConsumer = mocks.channel.consumers.get("chat.requests");
    expect(chatRequestsConsumer).toBeDefined();

    const deliveryPromise = (async () => {
      chatRequestsConsumer!({
        content: Buffer.from(JSON.stringify(job)),
        properties: { correlationId, replyTo },
      });
    })();

    // Advance timers past the chunk flush interval so buffered chunks are sent
    await vi.advanceTimersByTimeAsync(mocks.appConfig.chatQueueChunkFlushMs + 10);
    await deliveryPromise;

    // channel.sendToQueue should have been called targeting reply.q
    const calls = mocks.channel.sendToQueue.mock.calls as Array<[string, Buffer, { correlationId?: string }]>;
    const replyQueueCalls = calls.filter(([q]) => q === replyTo);
    expect(replyQueueCalls.length).toBeGreaterThan(0);

    // Gather all forwarded events
    const forwarded = replyQueueCalls.map(([, buf]) => JSON.parse(buf.toString()) as ChatStreamEvent);

    // The status event should have been forwarded
    expect(forwarded.some((e) => e.type === "status")).toBe(true);

    // The message chunks should have been coalesced or forwarded
    const messageEvents = forwarded.filter((e) => e.type === "message") as Array<{ type: "message"; data: { chunk: string } }>;
    const concatenated = messageEvents.map((e) => e.data.chunk).join("");
    expect(concatenated).toBe("Olá mundo");

    // The done event should have been forwarded
    expect(forwarded.some((e) => e.type === "done")).toBe(true);

    // channel.ack should have been called once
    expect(mocks.channel.ack).toHaveBeenCalledTimes(1);
  });

  it("publishes error event and still acks when runSectorAgent throws", async () => {
    const job = makeJob({ traceId: "trace-consumer-error" });
    const replyTo = "reply.error.q";
    const correlationId = job.traceId;

    mocks.runSectorAgent.mockRejectedValue(new Error("Falha catastrófica"));

    await startChatConsumer();

    const chatRequestsConsumer = mocks.channel.consumers.get("chat.requests");
    expect(chatRequestsConsumer).toBeDefined();

    await chatRequestsConsumer!({
      content: Buffer.from(JSON.stringify(job)),
      properties: { correlationId, replyTo },
    });

    // An error event should have been sent to the reply queue
    const calls = mocks.channel.sendToQueue.mock.calls as Array<[string, Buffer, { correlationId?: string }]>;
    const replyQueueCalls = calls.filter(([q]) => q === replyTo);
    expect(replyQueueCalls.length).toBeGreaterThan(0);

    const forwarded = replyQueueCalls.map(([, buf]) => JSON.parse(buf.toString()) as ChatStreamEvent);
    const errorEvents = forwarded.filter((e) => e.type === "error");
    expect(errorEvents.length).toBeGreaterThan(0);

    // channel.ack must still be called (finally block)
    expect(mocks.channel.ack).toHaveBeenCalledTimes(1);
  });
});
