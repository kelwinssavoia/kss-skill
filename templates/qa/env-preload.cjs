// kss-qa: re-applies the QA environment inside every Node process a service command starts.
// Loaded through NODE_OPTIONS=--require by qa.mjs. A task runner may rewrite the environment on
// its way to the final process (Nx, for one, unloads any variable equal to a root dotenv value and
// reloads .env.local first); this runs inside the final process, after all of that.
const file = process.env.KSS_QA_ENV_FILE
if (file) {
  try {
    const env = JSON.parse(require('fs').readFileSync(file, 'utf8'))
    for (const [k, v] of Object.entries(env)) process.env[k] = v
  } catch {
    /* never break a process over its environment */
  }
}
