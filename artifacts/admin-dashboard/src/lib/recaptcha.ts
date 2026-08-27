declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

let recaptchaLoader: Promise<NonNullable<Window["grecaptcha"]>> | null = null;

function loadGrecaptcha(siteKey: string): Promise<NonNullable<Window["grecaptcha"]>> {
  if (window.grecaptcha?.execute) return Promise.resolve(window.grecaptcha);
  if (recaptchaLoader) return recaptchaLoader;
  recaptchaLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-gcap-recaptcha]");
    if (existing) {
      const tick = () =>
        window.grecaptcha?.ready
          ? window.grecaptcha.ready(() => resolve(window.grecaptcha!))
          : setTimeout(tick, 50);
      tick();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.gcapRecaptcha = "1";
    script.onload = () => window.grecaptcha?.ready(() => resolve(window.grecaptcha!));
    script.onerror = () => reject(new Error("reCAPTCHA failed to load"));
    document.head.appendChild(script);
  });
  return recaptchaLoader;
}

export async function getAdminRecaptchaToken(siteKey: string | null | undefined): Promise<string | null> {
  if (!siteKey) return null;
  const g = await loadGrecaptcha(siteKey);
  const token = await g.execute(siteKey, { action: "admin_login" });
  if (!token) throw new Error("reCAPTCHA verification required");
  return token;
}
