// PostHog analytics (spec 10). Events are sent only after a save succeeds. Every event carries role, language
// and app_version. If VITE_POSTHOG_KEY is missing, all calls quietly do nothing.
import posthog from 'posthog-js';

export const APP_VERSION = '1.0.0';
const KEY = import.meta.env.VITE_POSTHOG_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';
let ready = false;

export function initAnalytics() {
  if (!KEY || ready) return;
  posthog.init(KEY, { api_host: HOST, autocapture: false, capture_pageview: true, persistence: 'localStorage' });
  posthog.register({ app_version: APP_VERSION });
  ready = true;
}

export function identifyUser(profile) {
  if (!ready || !profile) return;
  posthog.identify(profile.id);
  posthog.register({ role: profile.role, language: profile.language });
}

export function setLanguageProp(language) {
  if (ready) posthog.register({ language });
}

export function track(event, props = {}) {
  if (ready) posthog.capture(event, props);
}

export function resetAnalytics() {
  if (ready) posthog.reset();
}
