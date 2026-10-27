// Generates the lab artifact files (logs, emails, telemetry) into ./lab-files
// Run once: node generate-artifacts.js   (seed.js calls it automatically)

const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'lab-files');
fs.mkdirSync(outDir, { recursive: true });

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pad(n) {
  return String(n).padStart(2, '0');
}

// ---------- auth.log (SSH brute force) ----------
function genAuthLog() {
  const lines = [];
  const attacker = '203.0.113.77';
  const noiseIps = ['198.51.100.14', '198.51.100.22', '192.0.2.55', '10.0.0.15'];
  const users = ['root', 'admin', 'ubuntu', 'test', 'oracle', 'deploy', 'backup'];
  let pid = 2100;

  // Normal activity
  for (let i = 0; i < 40; i++) {
    const ip = rand(noiseIps);
    lines.push(
      `Oct 14 ${pad(8 + (i % 10))}:${pad(Math.floor(Math.random() * 60))}:${pad(
        Math.floor(Math.random() * 60)
      )} web-01 sshd[${pid++}]: ${
        Math.random() < 0.7
          ? `Accepted publickey for deploy from ${ip} port ${40000 + i} ssh2`
          : `Failed password for deploy from ${ip} port ${41000 + i} ssh2`
      }`
    );
  }

  // Brute force burst
  for (let i = 0; i < 180; i++) {
    const u = rand(users);
    lines.push(
      `Oct 14 02:${pad(Math.floor(i / 6))}:${pad((i * 10) % 60)} web-01 sshd[${pid++}]: Failed password for ${
        u === 'root' ? 'root' : 'invalid user ' + u
      } from ${attacker} port ${50000 + i} ssh2`
    );
  }

  // Other low-volume scanners (decoys)
  for (let i = 0; i < 6; i++) {
    lines.push(
      `Oct 14 03:1${i}:22 web-01 sshd[${pid++}]: Failed password for root from 192.0.2.${100 + i} port ${60000 + i} ssh2`
    );
  }

  // Successful compromise
  lines.push(
    `Oct 14 03:02:41 web-01 sshd[${pid++}]: Accepted password for root from ${attacker} port 50999 ssh2`
  );
  lines.push(
    `Oct 14 03:02:41 web-01 sshd[${pid++}]: pam_unix(sshd:session): session opened for user root by (uid=0)`
  );

  lines.sort();
  fs.writeFileSync(path.join(outDir, 'auth.log'), lines.join('\n') + '\n');
}

// ---------- access.log (SQL injection) ----------
function genAccessLog() {
  const lines = [];
  const normalPaths = ['/', '/index.php', '/about.php', '/products.php?id=3', '/contact.php', '/css/site.css', '/js/app.js'];
  const normalIps = ['198.51.100.14', '198.51.100.22', '192.0.2.55', '203.0.113.9'];
  const attacker = '203.0.113.200';
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  for (let i = 0; i < 150; i++) {
    lines.push(
      `${rand(normalIps)} - - [15/Oct/2026:09:${pad(Math.floor(i / 3) % 60)}:${pad(
        (i * 7) % 60
      )} +0000] "GET ${rand(normalPaths)} HTTP/1.1" 200 ${1000 + Math.floor(Math.random() * 4000)} "-" "${ua}"`
    );
  }

  const attacks = [
    ["/products.php?id=3'", 500, 312],
    ["/products.php?id=3%27%20OR%20%271%27=%271", 200, 4821],
    ["/products.php?id=3%20UNION%20SELECT%20NULL,NULL,NULL--", 200, 4790],
    ["/products.php?id=3%20UNION%20SELECT%20username,password,NULL%20FROM%20users--", 200, 5120],
    ['/admin/export.php', 200, 982340]
  ];
  attacks.forEach(([p, status, size], i) => {
    lines.push(
      `${attacker} - - [15/Oct/2026:10:1${i}:03 +0000] "GET ${p} HTTP/1.1" ${status} ${size} "-" "sqlmap/1.7"`
    );
  });

  lines.sort((a, b) => {
    const ta = a.match(/\[(.*?)\]/)[1];
    const tb = b.match(/\[(.*?)\]/)[1];
    return ta.localeCompare(tb);
  });
  fs.writeFileSync(path.join(outDir, 'access.log'), lines.join('\n') + '\n');
}

// ---------- suspicious-email.eml (phishing) ----------
function genEml() {
  const body = `Return-Path: <bounce@secure-payroll-update.example>
Received: from mail-gw.secure-payroll-update.example (203.0.113.45) by mx.corp.example with ESMTP; Wed, 14 Oct 2026 07:41:09 +0000
Received: from [10.12.3.4] (helo=localhost) by mail-gw.secure-payroll-update.example with local (Exim 4.96); Wed, 14 Oct 2026 07:41:05 +0000
Authentication-Results: mx.corp.example; spf=fail smtp.mailfrom=secure-payroll-update.example; dkim=none; dmarc=fail header.from=corp-hr.example
From: "HR Payroll" <payroll@corp-hr.example>
Reply-To: <collect@secure-payroll-update.example>
To: employee@corp.example
Subject: URGENT: Action required on your payroll account
Date: Wed, 14 Oct 2026 07:41:00 +0000
Message-ID: <20261014074100.GA1234@secure-payroll-update.example>
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8

Hello,

We detected an issue with your direct deposit details. To avoid a delay in
your next payment, confirm your information within 24 hours:

http://secure-payroll-update.example/login

HR Payroll Team
`;
  fs.writeFileSync(path.join(outDir, 'suspicious-email.eml'), body);
}

// ---------- proc-events.csv (IOC hunting) ----------
function genProcCsv() {
  const rows = ['timestamp,host,pid,ppid,process,parent,path,cmdline'];
  const legit = [
    ['svchost.exe', 'services.exe', 'C:\\Windows\\System32\\svchost.exe', 'svchost.exe -k netsvcs'],
    ['explorer.exe', 'userinit.exe', 'C:\\Windows\\explorer.exe', 'explorer.exe'],
    ['chrome.exe', 'explorer.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'chrome.exe'],
    ['notepad.exe', 'explorer.exe', 'C:\\Windows\\System32\\notepad.exe', 'notepad.exe notes.txt'],
    ['taskhostw.exe', 'svchost.exe', 'C:\\Windows\\System32\\taskhostw.exe', 'taskhostw.exe']
  ];
  for (let i = 0; i < 60; i++) {
    const p = rand(legit);
    rows.push(
      `2026-10-14T0${8 + (i % 2)}:${pad(i % 60)}:00Z,WS-114,${1000 + i},${400 + (i % 10)},${p[0]},${p[1]},${p[2]},"${p[3]}"`
    );
  }
  rows.push(
    '2026-10-14T09:33:12Z,WS-114,5120,3844,svch0st.exe,winword.exe,C:\\Users\\Public\\svch0st.exe,"svch0st.exe -connect 198.51.100.99:4444"'
  );
  fs.writeFileSync(path.join(outDir, 'proc-events.csv'), rows.join('\n') + '\n');
}

genAuthLog();
genAccessLog();
genEml();
genProcCsv();
console.log('Lab artifacts generated in', outDir);
