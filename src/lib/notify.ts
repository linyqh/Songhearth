import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import i18n from "i18next";
import type { Job } from "./types";

/** Localised "finished" notification, shown only while the window is in the background. */
export async function notifyJobDone(job: Job): Promise<void> {
  if (document.hasFocus()) return;
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return;
  sendNotification({
    title: i18n.t("shell:notification.title"),
    body: i18n.t("shell:notification.body", { title: job.title }),
  });
}
