import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily media cleanup:
// - removes expired orphan upload objects/sessions
// - trims old consumed upload session rows
crons.interval(
  "daily media cleanup",
  { hours: 24 },
  (internal as any).mediaCleanup.runDailyCleanup
);

export default crons;

