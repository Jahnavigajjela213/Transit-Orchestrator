import { Bell, CheckCircle2, Radar, SearchCheck, Shuffle, Truck, Wrench } from "lucide-react";

/** One icon per step of the vehicle-health flow, shared by Needs your attention and the orchestration page. */
export const STEP_ICON: Record<string, typeof Radar> = {
  detect: Radar, assess: SearchCheck, open_work_order: Wrench, pull_vehicle: Truck,
  reassign_runs: Shuffle, notify_riders: Bell, return_to_service: CheckCircle2,
};

/** The seven steps in order, for lists that only know which step an orchestration is on. */
export const STEP_KEYS = ["detect", "assess", "open_work_order", "pull_vehicle", "reassign_runs", "notify_riders", "return_to_service"];
