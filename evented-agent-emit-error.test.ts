import { Agent } from "@mastra/core/agent";
import { EventedAgent } from "@mastra/core/agent/durable";
import { EventEmitterPubSub } from "@mastra/core/events";
import { Mastra } from "@mastra/core/mastra";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";

// Reproduces: EventedAgent.executeWorkflow() publishes a failed run's terminal error from an
// un-awaited .catch handler. When that publish rejects (pubsub already closed during shutdown),
// Node reports an unhandledRejection. DurableAgent got emitErrorInBackground() in #23168;
// EventedAgent did not.
describe("EventedAgent terminal error publish", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    vi.restoreAllMocks();
  });

  it("does not leave an unhandled rejection when the pubsub refuses the error event", async () => {
    const agent = new EventedAgent({
      agent: new Agent({
        id: "repro",
        name: "Repro",
        instructions: "probe",
        model: new MockLanguageModelV3(),
      }),
    });
    const mastra = new Mastra({ agents: { repro: agent } });
    await mastra.startWorkers();

    // What closed storage does to the post-run cleanup in the .then branch:
    vi.spyOn(agent as any, "deleteRunSnapshots").mockRejectedValue(new Error("storage closed"));
    // What a closed pubsub does to the terminal error publish, and only to that publish:
    const realPublish = EventEmitterPubSub.prototype.publish;
    const publish = vi
      .spyOn(EventEmitterPubSub.prototype, "publish")
      .mockImplementation(async function (this: EventEmitterPubSub, topic, event) {
        if (event.type === "error") throw new Error("ValkeyStreamsPubSub: cannot publish on closed client");
        return realPublish.call(this, topic, event);
      });
    const warn = vi.spyOn(agent.logger, "warn").mockImplementation(() => {});

    try {
      const result = await agent.stream("hi");
      for await (const _ of result.output.fullStream) {
        // drain
      }
      result.cleanup();
      await new Promise((r) => setTimeout(r, 300));

      expect(publish.mock.calls.filter((c) => c[1]?.type === "error")).toHaveLength(1);
      expect(unhandled.map((e) => (e as Error).message)).toEqual([]);
      expect(warn).toHaveBeenCalled();
    } finally {
      await mastra.stopWorkers();
    }
  });
});
