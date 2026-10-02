/* config.js - where the page's workspace lives.

   Fill SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY with the project's values
   (Project Settings > API). The publishable key is safe in a page; it only
   lets the browser do what Row Level Security allows the signed-in person.

   Leave both empty and the page runs in DEMO mode: everything works, nothing
   is saved, and the header says so. Open it as ?env=local to point at a
   `supabase start` stack on this machine.

   RELEASE is in lockstep with every ?v= in CostTracker.html and the boot
   check in app/ui.js. Change all of them together. */
(function (root) {
  "use strict";
  var q = (typeof location !== "undefined" && location.search) || "";
  var env = /[?&]env=local\b/.test(q) ? "local" : "prod";
  var cfg = {
    RELEASE: "0.1.1",
    SUPABASE_URL: "",
    SUPABASE_PUBLISHABLE_KEY: "",
    env: env,
  };
  if (env === "local") {
    cfg.SUPABASE_URL = "http://127.0.0.1:54321";
    // the key every `supabase start` stack ships with; not a secret
    cfg.SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
  }
  cfg.mode = cfg.SUPABASE_URL ? "live" : "demo";
  root.CostConfig = cfg;
})(typeof self !== "undefined" ? self : this);
