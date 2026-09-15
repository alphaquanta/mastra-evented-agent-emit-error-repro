# EventedAgent terminal-error publish → unhandledRejection (@mastra/core 1.67.0)

`EventedAgent.executeWorkflow()` publishes a failed run's terminal error from an un-awaited
`.catch` handler. When that publish rejects (pubsub already closed during shutdown) Node reports
an `unhandledRejection`. mastra-ai/mastra#23168 fixed the same pattern in `DurableAgent`
(`emitErrorInBackground`) but not in `EventedAgent`.

```sh
pnpm install
pnpm test
```

Expected: the test passes (a refused error publish is logged, not left as an unhandled rejection).
Actual on 1.67.0: fails with `expected [ Array(1) ] to deeply equal []` — one unhandled rejection,
`ValkeyStreamsPubSub: cannot publish on closed client`.

The test uses the in-memory `EventEmitterPubSub` and stubs two things to make the shutdown race
deterministic: `deleteRunSnapshots` rejects (what closed storage does), and `publish` rejects only
for the terminal `error` event (what a closed pubsub does).
