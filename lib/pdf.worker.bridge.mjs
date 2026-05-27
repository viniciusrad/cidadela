import { parentPort } from "node:worker_threads";

import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

if (!parentPort) {
  throw new Error("pdf.worker.bridge.mjs precisa rodar dentro de worker_threads.");
}

const messageListeners = new Map();

const workerPort = {
  postMessage(message, transfer) {
    parentPort.postMessage(message, transfer ?? []);
  },
  addEventListener(type, listener, options = {}) {
    if (type !== "message") {
      return;
    }

    const wrappedListener = (data) => {
      listener({ data });
    };

    messageListeners.set(listener, wrappedListener);
    parentPort.on("message", wrappedListener);

    options.signal?.addEventListener(
      "abort",
      () => {
        parentPort.off("message", wrappedListener);
        messageListeners.delete(listener);
      },
      { once: true },
    );
  },
  removeEventListener(type, listener) {
    if (type !== "message") {
      return;
    }

    const wrappedListener = messageListeners.get(listener);
    if (!wrappedListener) {
      return;
    }

    parentPort.off("message", wrappedListener);
    messageListeners.delete(listener);
  },
};

globalThis.self = workerPort;
globalThis.postMessage = workerPort.postMessage.bind(workerPort);
globalThis.addEventListener = workerPort.addEventListener.bind(workerPort);
globalThis.removeEventListener = workerPort.removeEventListener.bind(workerPort);
globalThis.onmessage = null;

WorkerMessageHandler.initializeFromPort(workerPort);
