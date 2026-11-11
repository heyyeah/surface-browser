// Page HTML is parsed on worker threads with a deadline. parse5 and cheerio are
// quadratic on deeply nested tags: 200 KB of nested <div>s costs seconds and 1 MB
// minutes, which on the main thread froze every visitor's requests.
import { Worker } from "node:worker_threads";
import { parseNonNegativeInteger, parsePositiveInteger } from "./env.js";

const WORKER_URL = new URL("./html-parse-worker.js", import.meta.url);
const POOL_SIZE = parsePositiveInteger(process.env.HTML_PARSE_WORKERS, 2);
const PARSE_DEADLINE_MS = parseNonNegativeInteger(process.env.HTML_PARSE_DEADLINE_MS, 3000);
// Queued parses beyond this are refused rather than piling up behind slow ones.
const QUEUE_MAX = 32;

export class HtmlParseError extends Error {}

const idle = [];
let workerCount = 0;
const queue = [];
let nextId = 1;

function spawn() {
  const worker = new Worker(WORKER_URL);
  workerCount += 1;
  // Not a reason to keep the process alive (tests, shutdown).
  worker.unref();
  worker.on("error", () => retire(worker, "HTML parse failed"));
  worker.on("exit", () => retire(worker, "HTML parse failed"));
  return worker;
}

// The worker's current job fails and the worker is replaced on next demand.
function retire(worker, message) {
  if (worker.retired) {
    return;
  }
  worker.retired = true;
  workerCount -= 1;
  const index = idle.indexOf(worker);
  if (index >= 0) {
    idle.splice(index, 1);
  }
  const job = worker.job;
  worker.job = null;
  if (job) {
    clearTimeout(job.timer);
    job.reject(new HtmlParseError(message));
  }
  void worker.terminate();
  pump();
}

function pump() {
  while (queue.length) {
    let worker = idle.pop();
    if (!worker && workerCount < POOL_SIZE) {
      worker = spawn();
    }
    if (!worker) {
      return;
    }
    run(worker, queue.shift());
  }
}

function run(worker, job) {
  worker.job = job;
  if (PARSE_DEADLINE_MS) {
    job.timer = setTimeout(() => retire(worker, "Page HTML took too long to parse"), PARSE_DEADLINE_MS);
  }
  const onMessage = (reply) => {
    if (reply.id !== job.id || worker.job !== job) {
      return;
    }
    worker.off("message", onMessage);
    clearTimeout(job.timer);
    worker.job = null;
    idle.push(worker);
    if (reply.error) {
      job.reject(new HtmlParseError(reply.error));
    } else {
      job.resolve(reply.result);
    }
    pump();
  };
  worker.on("message", onMessage);
  worker.postMessage({ id: job.id, html: job.html, sourceUrl: job.sourceUrl, limit: job.limit });
}

// Resolves { title, items } as parseHtmlForImages does; rejects HtmlParseError
// when the parse overruns, fails, or too many are waiting.
export function parseHtmlForImagesOffThread(html, sourceUrl, limit) {
  if (queue.length >= QUEUE_MAX) {
    return Promise.reject(new HtmlParseError("Too many pages waiting to be parsed"));
  }
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, html, sourceUrl, limit, resolve, reject, timer: null });
    pump();
  });
}
