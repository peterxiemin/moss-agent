# Security Policy

Please do not disclose suspected vulnerabilities in public issues.

Report them through GitHub's private vulnerability reporting page:

https://github.com/peterxiemin/moss-agent/security/advisories/new

Do not include real credentials, private source code, personal data, or production logs in a report. Use minimal synthetic examples whenever possible.

## Runtime trust boundary

moss-agent can read project files and, after user approval, modify files or run shell commands. Only use it with model endpoints and working directories you trust. Automatic approval mode (`-y`) is intended for isolated environments.
