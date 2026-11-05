import { handle } from "@astrojs/cloudflare/handler";
import { getOutlook } from "./server/outlook";

export default {
  fetch: handle,
  scheduled(_event: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(
      getOutlook(env, true)
        .then((result) => {
          if (result.freshness === "stale")
            throw new Error("Scheduled refresh retained stale outlook");
        })
        .catch(() => {
          console.error(JSON.stringify({ event: "scheduled_outlook_failed" }));
          throw new Error("Scheduled outlook refresh failed");
        }),
    );
  },
};
