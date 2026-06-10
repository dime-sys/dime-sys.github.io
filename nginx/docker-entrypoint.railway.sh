#!/bin/sh
set -e

if [ -z "$BACKEND_INTERNAL_URL" ]; then
  echo "ERROR: BACKEND_INTERNAL_URL environment variable is not set." >&2
  exit 1
fi

echo "INFO: Substituting BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL"
envsubst '$BACKEND_INTERNAL_URL' \
  < /etc/nginx/nginx.railway.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "INFO: Generated nginx config:"
cat /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
