/**
 * Shared-folder inspection. Includes Time Machine flags + quota where set.
 *
 * SYNO.Core.Share — list with additional fields
 */

import type { DsmClient } from "../dsm.js";

export async function nasSharesList(dsm: DsmClient) {
  const data = await dsm.call({
    api: "SYNO.Core.Share",
    method: "list",
    version: 1,
    params: {
      shareType: "all",
      additional:
        '["hidden","encryption","is_aclmode","unite_permission","is_support_acl","is_sync_share","is_force_readonly","force_readonly_reason","recyclebin","share_quota","enable_share_cow","enable_share_compress","share_quota_status","enable_share_tiering","support_snapshot","enable_time_machine"]',
    },
  });
  return {
    shares: (data?.shares ?? []).map((s: any) => ({
      name: s.name,
      path: s.path,
      vol_path: s.vol_path,
      enabled: !s.disable,
      enable_time_machine: s.additional?.enable_time_machine,
      encryption: s.additional?.encryption,
      quota_mb: s.additional?.share_quota,
      quota_status: s.additional?.share_quota_status,
      recycle_bin: s.additional?.recyclebin,
      btrfs_cow: s.additional?.enable_share_cow,
      support_snapshot: s.additional?.support_snapshot,
    })),
  };
}
