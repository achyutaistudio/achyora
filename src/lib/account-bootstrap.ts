type BootstrapAccount = () => Promise<unknown>;

const BOOTSTRAP_TIMEOUT_MS = 5_000;

/**
 * Account provisioning is best-effort after authentication. It must never
 * delay navigation or turn a valid session into an authentication failure.
 */
export function startAccountBootstrap(bootstrapAccount: BootstrapAccount): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Account bootstrap timed out and will be retried later.")),
      BOOTSTRAP_TIMEOUT_MS,
    );
  });

  void Promise.race([Promise.resolve().then(bootstrapAccount), timeout])
    .catch((error: unknown) => {
      console.error("[achyora] account bootstrap failed", error);
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}
