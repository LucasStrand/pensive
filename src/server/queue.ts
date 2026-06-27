// Serialize jobs. GitHub fires `synchronize` on every push and each review hits
// the model API, so running one at a time keeps cost and rate limits sane.
type Job<T> = () => Promise<T>;
let tail: Promise<unknown> = Promise.resolve();

export function enqueue<T>(job: Job<T>): Promise<T> {
  const run = tail.then(job, job);
  // keep the chain alive even when a job throws
  tail = run.then(() => undefined, () => undefined);
  return run;
}
