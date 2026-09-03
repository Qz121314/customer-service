export function createAgentInboxRecoveryCoordinator(
  recoverOnce: () => Promise<void>,
): { recover: () => Promise<void> } {
  let inFlight: Promise<void> | null = null;
  let trailing = false;

  const recover = (): Promise<void> => {
    if (inFlight) {
      trailing = true;
      return inFlight;
    }

    const run = async (): Promise<void> => {
      do {
        trailing = false;
        await recoverOnce();
      } while (trailing);
    };

    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return { recover };
}
