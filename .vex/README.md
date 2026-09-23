# VEX statements

OpenVEX documents consumed by scanners (grype `--vex`, trivy `--vex`,
dependency-track) to suppress known non-applicable findings in this repo and
in the published images and binaries.

`openvex.json` statements use `status`: `not_affected`, `fixed`,
`under_investigation`, or `affected`. Example statement shape:

```json
{
  "vulnerability": {"name": "CVE-0000-00000"},
  "products": [{"@id": "pkg:oci/forge-rootless@sha256:..."}],
  "status": "not_affected",
  "justification": "vulnerable_code_not_present",
  "impactStatement": "reason"
}
```
