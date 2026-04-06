/**
 * In-memory job queue with SSE broadcast for render progress
 */

const jobs = new Map(); // jobId -> job state

export function createJob(projectId, projectName) {
  const id = crypto.randomUUID();
  const job = {
    id,
    projectId,
    projectName,
    status: "pending", // pending | running | complete | error
    progress: 0,
    totalDuration: 0,
    currentTime: 0,
    speed: 0,
    fps: 0,
    error: null,
    outputFile: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    listeners: new Set(), // SSE controllers
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function listJobs() {
  return Array.from(jobs.values()).map(j => ({
    id: j.id,
    projectId: j.projectId,
    projectName: j.projectName,
    status: j.status,
    progress: j.progress,
    createdAt: j.createdAt,
    completedAt: j.completedAt,
  }));
}

export function updateJobProgress(jobId, { timeMs, speed, fps }) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.currentTime = timeMs;
  job.speed = speed;
  job.fps = fps;

  if (job.totalDuration > 0) {
    job.progress = Math.min(100, (timeMs / (job.totalDuration * 1000)) * 100);
  }

  broadcast(job, {
    type: "progress",
    progress: job.progress,
    currentTime: timeMs,
    totalDuration: job.totalDuration,
    speed,
    fps,
  });
}

export function completeJob(jobId, outputFile) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "complete";
  job.progress = 100;
  job.outputFile = outputFile;
  job.completedAt = new Date().toISOString();

  broadcast(job, { type: "complete", outputFile });
  closeListeners(job);
}

export function failJob(jobId, error) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "error";
  job.error = String(error);
  job.completedAt = new Date().toISOString();

  broadcast(job, { type: "error", error: job.error });
  closeListeners(job);
}

export function addListener(jobId, controller) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.listeners.add(controller);
  return true;
}

export function removeListener(jobId, controller) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.listeners.delete(controller);
}

function broadcast(job, data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const controller of job.listeners) {
    try {
      controller.enqueue(new TextEncoder().encode(msg));
    } catch {
      job.listeners.delete(controller);
    }
  }
}

function closeListeners(job) {
  for (const controller of job.listeners) {
    try {
      controller.close();
    } catch { /* already closed */ }
  }
  job.listeners.clear();
}
