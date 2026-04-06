/**
 * Render job routes - start renders, SSE progress, job status
 */

import { join } from "node:path";
import { getProject } from "../../lib/projects.js";
import { buildCommand, runFfmpeg } from "../../lib/ffmpeg.js";
import { createJob, getJob, listJobs, updateJobProgress, completeJob, failJob, addListener, removeListener } from "../../lib/jobs.js";

let outputDir = "data/output";

export function registerRenderRoutes(router, config) {
  outputDir = config.storage?.output_dir || "data/output";

  // Start render
  router.post("/api/render", async (ctx) => {
    const body = await ctx.req.json();
    const { projectId } = body;

    if (!projectId) {
      return json({ error: "projectId is required" }, 400);
    }

    const project = await getProject(projectId);
    if (!project) {
      return json({ error: "Project not found" }, 404);
    }

    // Calculate total duration from timeline
    let totalDuration = 0;
    for (const track of project.timeline.tracks) {
      for (const item of track.items || []) {
        const end = (item.startTime || 0) + ((item.trimOut || item.duration || 0) - (item.trimIn || 0));
        if (end > totalDuration) totalDuration = end;
      }
    }

    const job = createJob(projectId, project.name);
    job.totalDuration = totalDuration;
    job.status = "running";

    const ext = project.settings.format || "mp4";
    const outputFile = `${job.id}.${ext}`;
    const outputPath = join(outputDir, outputFile);

    // Run render in background
    try {
      console.log("[render] project:", project.name, "tracks:", project.timeline.tracks.length,
        "items:", project.timeline.tracks.reduce((n, t) => n + (t.items?.length || 0), 0));
      const args = buildCommand(project, outputPath);

      runFfmpeg(args, (progress) => {
        updateJobProgress(job.id, progress);
      }).then(() => {
        completeJob(job.id, outputFile);
      }).catch((err) => {
        failJob(job.id, err.message);
      });
    } catch (err) {
      failJob(job.id, err.message);
    }

    return json({ jobId: job.id, status: job.status });
  });

  // SSE progress stream
  router.get("/api/render/:jobId/progress", async (ctx) => {
    const { jobId } = ctx.params;
    const job = getJob(jobId);

    if (!job) {
      return json({ error: "Job not found" }, 404);
    }

    // If job already complete, send final status and close
    if (job.status === "complete" || job.status === "error") {
      const msg = job.status === "complete"
        ? `data: ${JSON.stringify({ type: "complete", outputFile: job.outputFile })}\n\n`
        : `data: ${JSON.stringify({ type: "error", error: job.error })}\n\n`;

      return new Response(msg, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        addListener(jobId, controller);

        // Send initial status
        const initial = `data: ${JSON.stringify({
          type: "progress",
          progress: job.progress,
          status: job.status,
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(initial));
      },
      cancel(controller) {
        removeListener(jobId, controller);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });

  // Job status (polling)
  router.get("/api/render/:jobId", async (ctx) => {
    const { jobId } = ctx.params;
    const job = getJob(jobId);
    if (!job) return json({ error: "Job not found" }, 404);

    return json({
      id: job.id,
      projectId: job.projectId,
      status: job.status,
      progress: job.progress,
      error: job.error,
      outputFile: job.outputFile,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
