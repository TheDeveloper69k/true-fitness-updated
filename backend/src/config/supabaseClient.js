const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase/PostgREST credentials are missing in .env");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    // Self-hosted PostgREST (see SUPABASE_URL) serves tables at the root
    // path, not under /rest/v1/ like the hosted Supabase gateway does.
    fetch: (url, opts) => {
      return fetch(url.replace('/rest/v1/', '/'), opts);
    }
  }
});

module.exports = supabase;
