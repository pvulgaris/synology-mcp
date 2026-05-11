/**
 * Security-related read tools. All read-only; no auto-remediation.
 *
 * SYNO.SecurityAdvisor.Conf.Checklist  — async scan
 * SYNO.Core.User                       — accounts + 2FA
 * SYNO.Core.Security.Firewall.Profile  — firewall rules
 * SYNO.Core.Security.AutoBlock         — auto-block + DoS
 * SYNO.Core.DSM                        — HTTPS-only, SSH, SMB, auto-update
 */

import type { DsmClient } from "../dsm.js";

const SCAN_POLL_MS = 2000;
const SCAN_TIMEOUT_MS = 5 * 60 * 1000;

export async function nasSecurityAdvisorScan(dsm: DsmClient) {
  // Kick off a scan.
  await dsm
    .call({
      api: "SYNO.SecurityAdvisor.Conf.Checklist",
      method: "start_scan",
      version: 1,
      post: true,
    })
    .catch(() => null); // already-running scans return non-success; ignore and poll.

  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await dsm.call({
      api: "SYNO.SecurityAdvisor.Conf.Checklist",
      method: "get_status",
      version: 1,
    });
    if (status?.status === "finished" || status?.scanning === false) break;
    await new Promise((r) => setTimeout(r, SCAN_POLL_MS));
  }

  const results = await dsm.call({
    api: "SYNO.SecurityAdvisor.Conf.Checklist",
    method: "list",
    version: 1,
  });

  const grouped: Record<string, any[]> = {
    critical: [],
    warning: [],
    info: [],
    safe: [],
  };
  for (const item of results?.items ?? results?.checklist ?? []) {
    const sev = (item.level ?? item.severity ?? "info").toLowerCase();
    const bucket = grouped[sev] ?? grouped.info;
    bucket.push({
      id: item.id ?? item.check_id,
      title: item.desc ?? item.title,
      detail: item.detail ?? item.remediation,
      level: sev,
    });
  }
  return { findings: grouped };
}

export async function nasUsersList(dsm: DsmClient) {
  const data = await dsm.call({
    api: "SYNO.Core.User",
    method: "list",
    version: 1,
    params: { additional: '["email","description","expired","cannot_chg_passwd","passwd_never_expire","otp_enable"]' },
  });
  return {
    users: (data?.users ?? []).map((u: any) => ({
      name: u.name,
      uid: u.uid,
      description: u.additional?.description,
      email: u.additional?.email,
      expired: u.additional?.expired,
      otp_enabled: u.additional?.otp_enable,
      cannot_change_password: u.additional?.cannot_chg_passwd,
    })),
  };
}

export async function nasFirewallList(dsm: DsmClient) {
  const profiles = await dsm
    .call({
      api: "SYNO.Core.Security.Firewall.Profile",
      method: "list",
      version: 1,
    })
    .catch(() => ({ profiles: [] }));
  const autoblock = await dsm
    .call({
      api: "SYNO.Core.Security.AutoBlock",
      method: "get",
      version: 1,
    })
    .catch(() => null);
  const dos = await dsm
    .call({
      api: "SYNO.Core.Security.DoS",
      method: "get",
      version: 1,
    })
    .catch(() => null);
  return {
    firewall_profiles: profiles?.profiles ?? [],
    auto_block: autoblock,
    dos_protection: dos,
  };
}

export async function nasDsmSecuritySettings(dsm: DsmClient) {
  const [https, ssh, smb, terminal, autoUpdate, passwd] = await Promise.all([
    dsm.call({ api: "SYNO.Core.Security.DSM", method: "get", version: 1 }).catch(() => null),
    dsm.call({ api: "SYNO.Core.Terminal", method: "get", version: 1 }).catch(() => null),
    dsm.call({ api: "SYNO.Core.FileServ.SMB", method: "get", version: 1 }).catch(() => null),
    dsm.call({ api: "SYNO.Core.Terminal", method: "get", version: 1 }).catch(() => null),
    dsm.call({ api: "SYNO.Core.Upgrade.Setting", method: "get", version: 1 }).catch(() => null),
    dsm.call({ api: "SYNO.Core.User.PasswordPolicy", method: "get", version: 1 }).catch(() => null),
  ]);
  return {
    https_only: https?.enable_https_redirect ?? null,
    https_min_tls: https?.min_tls,
    ssh_enabled: ssh?.enable_ssh ?? null,
    ssh_port: ssh?.ssh_port,
    smb: {
      min_version: smb?.min_protocol,
      max_version: smb?.max_protocol,
      encryption: smb?.enable_encryption,
      enable_smb1: smb?.enable_smb1,
    },
    auto_update_dsm: autoUpdate?.auto_update_type ?? null,
    password_policy: passwd,
  };
}
