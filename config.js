/* BD Analytics — runtime configuration.
 *
 * LIVE MODE: point apiBase at the deployed Civix Analytics FastAPI backend.
 *   e.g. apiBase: "https://civix-api.onrender.com"
 * DEMO MODE: leave apiBase empty — the site runs on the bundled
 *   data/snapshot.json (precomputed, survey-weighted indicator values).
 */
window.BD_CONFIG = {
  apiBase: "",
  company: {
    name: "BD Analytics",
    founder: "Bulelani Dlamini",
    email: "Juniorlurh@gmail.com",
    phone: "0751618439",
    address: "369 Lyeds Street, Sunnyside, Pretoria",
  },
  platform: {
    name: "Civix Analytics",
    tagline: "Evidence-grounded socio-economic intelligence",
    survey: "General Household Survey 2024 (Stats SA P0318)",
  },
};
