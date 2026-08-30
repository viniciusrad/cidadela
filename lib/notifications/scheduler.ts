import { appConfig } from "@/lib/config";

const globalForNotifications = globalThis as typeof globalThis & {
  __cidadelaNotificationsStarted?: boolean;
};

function runSafely(label: string, work: () => Promise<unknown>) {
  void work().catch((error) => {
    console.warn(
      `[notifications] Falha em ${label}:`,
      error instanceof Error ? error.message : error,
    );
  });
}

export function startNotificationSchedules() {
  if (!appConfig.notificationsEnabled) {
    return;
  }

  if (globalForNotifications.__cidadelaNotificationsStarted) {
    return;
  }
  globalForNotifications.__cidadelaNotificationsStarted = true;

  setInterval(() => {
    runSafely("daily-owner-digest", async () => {
      const { runDailyOwnerDigest } = await import("@/lib/notifications/daily-digest");
      return runDailyOwnerDigest();
    });
  }, appConfig.notificationsIntervalMs);

  setInterval(() => {
    runSafely("weekly-digest", async () => {
      const { runWeeklyTeamsDigest } = await import("@/lib/notifications/weekly-digest");
      return runWeeklyTeamsDigest();
    });
  }, appConfig.weeklyDigestIntervalMs);
}
