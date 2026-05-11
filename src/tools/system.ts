/**
 * System-level read tools: status, storage health.
 */

import type { DsmClient } from "../dsm.js";

export async function nasStatus(dsm: DsmClient) {
  const [info, util] = await Promise.all([
    dsm.call({ api: "SYNO.Core.System", method: "info", version: 3 }),
    dsm.call({
      api: "SYNO.Core.System.Utilization",
      method: "get",
      version: 1,
    }).catch(() => null),
  ]);
  return {
    model: info?.model,
    serial: info?.serial,
    dsm_version: info?.firmware_ver,
    uptime_seconds: info?.up_time,
    temperature_c: info?.temperature,
    cpu_load: util?.cpu,
    memory: util?.memory,
    fan: info?.systempwarn,
  };
}

export async function nasStorageHealth(dsm: DsmClient) {
  const [volumes, disks] = await Promise.all([
    dsm.call({
      api: "SYNO.Core.Storage.Volume",
      method: "list",
      version: 1,
    }),
    dsm.call({
      api: "SYNO.Storage.CGI.Storage",
      method: "load_info",
      version: 1,
    }).catch(() => null),
  ]);
  return {
    volumes: (volumes?.volumes ?? []).map((v: any) => ({
      id: v.id,
      status: v.status,
      fs: v.fs_type,
      size_total: v.size?.total,
      size_used: v.size?.used,
      raid_level: v.raid_type,
    })),
    drives: (disks?.disks ?? []).map((d: any) => ({
      id: d.id,
      model: d.model,
      status: d.status,
      smart_status: d.smart_status,
      temp_c: d.temp,
      size: d.size_total,
      slot: d.diskPath ?? d.slot,
    })),
  };
}
