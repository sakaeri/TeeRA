#!/usr/bin/env bash
set -euo pipefail

TOKEN=$(node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))")

read -r COMPANY_ID COMPANY_NAME ADMIN_ID <<EOF
$(PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -F' ' -c "select c.id, c.name, cm.\"userId\" from \"Company\" c join \"CompanyMembership\" cm on cm.\"companyId\"=c.id and cm.role='COMPANY_ADMIN' order by c.\"createdAt\" desc limit 1;")
EOF

PGPASSWORD=postgres psql -h localhost -U postgres -d teera -c "insert into \"InviteToken\" (id, token, kind, \"companyId\", \"createdByUserId\", \"expiresAt\", \"createdAt\") values (gen_random_uuid()::text, '$TOKEN', 'STAFF', '$COMPANY_ID', '$ADMIN_ID', now() + interval '1 hour', now());" > /dev/null

echo "$TOKEN|$COMPANY_ID|$COMPANY_NAME"
