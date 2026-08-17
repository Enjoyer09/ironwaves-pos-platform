// Campaign countdown math (OffersTab F4), extracted into pure helpers so the
// ticker predicate and the (exp − start) progress bar can be unit-tested.
//
// Behavior is a 1:1 copy of what OffersTab renders:
//   - the 1s interval only runs while at least one campaign QR is active
//   - progress is timeLeft / (exp − start), clamped to [0, 100]; when `start`
//     is missing (legacy local activations) it falls back to 900000 ms.
export type ActivatedCampaign = { exp: number; start: number };

export function hasActiveCampaign(
  activated: Record<string, ActivatedCampaign>,
  now: number,
): boolean {
  return Object.values(activated).some((a) => a.exp > now);
}

export type CampaignCountdown = {
  isActive: boolean;
  timeLeftMs: number;
  secondsLeft: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  progressPct: number;
};

export function campaignCountdown(
  exp: number | undefined,
  start: number | undefined,
  now: number,
): CampaignCountdown {
  const isActive = !!exp && exp > now;
  const timeLeftMs = isActive ? exp - now : 0;
  const secondsLeft = Math.max(0, Math.floor(timeLeftMs / 1000));
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const totalMs = isActive && start ? exp - start : 900000;
  const progressPct = isActive
    ? Math.max(0, Math.min(100, (timeLeftMs / totalMs) * 100))
    : 0;
  return { isActive, timeLeftMs, secondsLeft, minutes, seconds, totalMs, progressPct };
}

// "MM:SS" string as rendered in the campaign card's timer chip.
export function formatCountdown(minutes: number, seconds: number): string {
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
